import type { TablesToSync } from "@connected-repo/zod-schemas/enums.zod";
import { orpcFetch } from "../../utils/orpc.client";
import { journalEntriesDb } from "../../modules/journal-entries/worker/journal-entries.db";
import { promptsDb } from "../../modules/prompts/worker/prompts.db";
import { subscribe } from "../db/db.manager";
import { filesDb } from "../db/files.db";
import { syncMetadataDb } from "../db/sync_metadata.db";
import { teamMembersDb } from "../db/team_members.db";
import { teamsAppDb } from "../db/teams_app.db";
import { getActiveTeamId, setActiveTeamId as _setActiveTeamId } from "./active_team";
import { fileUploadWorker } from "./file_upload.worker";

/**
 * Sync orchestrator (no SSE).
 *
 * Wave-1 anchor mints `topLevelSyncedAt` server-side; every downstream
 * pull echoes it back so the whole cycle sees a consistent snapshot
 * ceiling.
 *
 * Push and pull run as separate pipelines within one cycle. Push covers
 * `journalEntries.pushCreates` (creates + nested files metadata) and
 * `files.pushCdnUpdates` (post-upload URL patches). Pull covers every
 * synced table in wave order.
 *
 * Trigger sources (removed with the SSE cleanup, replaced by):
 *   1. `visibilitychange` / `focus` on the main thread (via
 *      `dataProxy.sync.processQueue()`).
 *   2. Browser `online` event on the main thread.
 *   3. Post-write kick from `OnlineFirstAdapter` when the online path
 *      falls back to offline.
 *   4. `subscribe()` DB-write callback in this worker.
 *   5. A slow interval (60s) as a safety net.
 *
 * Concurrency is controlled by an `isProcessing` flag + `needsRescan`
 * bit. A second trigger arriving during a cycle sets the bit; the
 * current cycle re-runs on completion.
 */
class SyncOrchestrator {
	private isProcessing = false;
	private needsRescan = false;
	private intervalHandle: ReturnType<typeof setInterval> | null = null;

	private readonly WAVE_ORDER: TablesToSync[] = [
		"teamsApp",
		"teamMembers",
		"prompts",
		"journalEntries",
		"files",
	];

	start(): void {
		if (this.intervalHandle) return;

		// Trigger #4: any local write fans out here via BroadcastChannel.
		subscribe((table) => {
			if (
				table === "journalEntries" ||
				table === "files" ||
				table === "teamsApp" ||
				table === "teamMembers"
			) {
				this.processQueue();
			}
		});

		// Trigger #2: browser `online` event fires in the worker context too.
		self.addEventListener("online", () => {
			this.processQueue();
		});

		// Trigger #5: safety-net interval.
		this.intervalHandle = setInterval(() => {
			this.processQueue();
		}, 60_000);
	}

	stop(): void {
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	setActiveTeamId(id: string | null): void {
		_setActiveTeamId(id);
		if (id) this.processQueue();
	}

	/**
	 * Entry point for every trigger. Locks against concurrent runs; if a
	 * trigger arrives while a cycle is in flight, we set `needsRescan`
	 * and the current cycle re-invokes itself on completion.
	 */
	async processQueue(): Promise<void> {
		if (this.isProcessing) {
			this.needsRescan = true;
			return;
		}
		if (!self.navigator?.onLine) return;

		const teamId = getActiveTeamId();
		if (!teamId) return; // no active team → nothing to sync

		this.isProcessing = true;
		this.needsRescan = false;
		await syncMetadataDb.saveCycleState({ lastAttemptedAt: Date.now() });

		try {
			await this.runCycle(teamId);
			await syncMetadataDb.saveCycleState({
				lastCompletedAt: Date.now(),
				lastError: null,
			});
		} catch (err) {
			await syncMetadataDb.saveCycleState({
				lastError: err instanceof Error ? err.message : String(err),
			});
			// biome-ignore lint/suspicious/noConsole: sync failures should surface in devtools
			console.warn("[SyncOrchestrator] cycle failed", err);
		} finally {
			this.isProcessing = false;
			if (this.needsRescan) {
				this.needsRescan = false;
				void this.processQueue();
			}
		}
	}

	private async runCycle(_teamId: string): Promise<void> {
		// Kick off file uploads in parallel — they don't need the sync
		// wave order and can run alongside the pull pipeline.
		void fileUploadWorker.run();

		// Wave 1 — anchor: mints `topLevelSyncedAt` and pulls team rows.
		const topLevelSyncedAt = await this.pullTeamsApp();

		// Push and pull run as two parallel pipelines walking the remaining
		// waves. Match the tezi model: `Future.wait([push, pull])`.
		await Promise.all([this.runPushPipeline(), this.runPullPipeline(topLevelSyncedAt)]);
	}

	// ─── Pull pipeline ─────────────────────────────────────────────────

	private async pullTeamsApp(): Promise<number> {
		const cursor = await syncMetadataDb.getCursor("teamsApp");
		const res = await orpcFetch.teams.pullDelta({
			syncMetadata: cursor ?? null,
		});
		await teamsAppDb.bulkUpsert(res.rows);
		await syncMetadataDb.saveCursor("teamsApp", res.syncMetadata);
		await syncMetadataDb.saveTopLevelSyncedAt(res.topLevelSyncedAt);
		return res.topLevelSyncedAt;
	}

	private async runPullPipeline(topLevelSyncedAt: number): Promise<void> {
		// Waves after the anchor. Run sequentially — order preserves the
		// dependency: team members reference teams, journal entries
		// reference teams and members, files reference journal entries.
		for (const table of this.WAVE_ORDER) {
			if (table === "teamsApp") continue;
			try {
				await this.pullTable(table, topLevelSyncedAt);
			} catch (err) {
				// biome-ignore lint/suspicious/noConsole: table-level failures shouldn't kill the whole cycle
				console.warn(`[SyncOrchestrator] pull ${table} failed`, err);
			}
		}
	}

	private async pullTable(table: TablesToSync, topLevelSyncedAt: number): Promise<void> {
		const cursor = await syncMetadataDb.getCursor(table);
		const input = {
			syncMetadata: cursor ?? null,
			topLevelSyncedAt,
		};

		if (table === "teamMembers") {
			const res = await orpcFetch.teams.pullMembersDelta(input);
			await teamMembersDb.bulkUpsert(res.rows);
			await syncMetadataDb.saveCursor(table, res.syncMetadata);
			return;
		}
		if (table === "prompts") {
			const res = await orpcFetch.prompts.pullDelta(input);
			await promptsDb.bulkUpsert(res.rows);
			await syncMetadataDb.saveCursor(table, res.syncMetadata);
			return;
		}
		if (table === "journalEntries") {
			const res = await orpcFetch.journalEntries.pullDelta(input);
			await journalEntriesDb.bulkUpsertFromServer(res.rows);
			await syncMetadataDb.saveCursor(table, res.syncMetadata);
			return;
		}
		if (table === "files") {
			const res = await orpcFetch.files.pullDelta(input);
			await filesDb.bulkUpsertFromServer(res.rows);
			await syncMetadataDb.saveCursor(table, res.syncMetadata);
			return;
		}
	}

	// ─── Push pipeline ─────────────────────────────────────────────────

	private async runPushPipeline(): Promise<void> {
		try {
			await this.pushJournalEntryCreates();
		} catch (err) {
			// biome-ignore lint/suspicious/noConsole: same rationale as pull failures
			console.warn("[SyncOrchestrator] pushJournalEntryCreates failed", err);
		}
		try {
			await this.pushFileCdnUpdates();
		} catch (err) {
			// biome-ignore lint/suspicious/noConsole:
			console.warn("[SyncOrchestrator] pushFileCdnUpdates failed", err);
		}
	}

	private async pushJournalEntryCreates(): Promise<void> {
		const teamId = getActiveTeamId();
		if (!teamId) return;

		const pending = await journalEntriesDb.getPending(teamId);
		if (pending.length === 0) return;

		// Bundle each pending entry with its nested files. Files are the
		// LOCAL rows attached to this journal entry.
		const creates = await Promise.all(
			pending.map(async (entry) => {
				const localFiles = await filesDb.getAllForParent("journalEntries", entry.id);
				return {
					id: entry.id,
					content: entry.content,
					prompt: entry.prompt,
					promptId: entry.promptId,
					teamId: entry.teamId,
					deletedAt: entry.deletedAt,
					files: localFiles.map((f) => ({
						id: f.id,
						tableName: f.tableName,
						tableId: f.tableId,
						type: f.type,
						fileName: f.fileName,
						mimeType: f.mimeType,
						teamId: f.teamId,
						deletedAt: f.deletedAt,
						isMainFileLost: f.isMainFileLost,
						// cdnUrl / thumbnailCdnUrl are patched later via pushCdnUpdates.
						cdnUrl: null,
						thumbnailCdnUrl: null,
					})),
				};
			}),
		);

		const res = await orpcFetch.journalEntries.pushCreates({ creates });

		for (const result of res.results) {
			if (result.ok && result.row) {
				await journalEntriesDb.overwriteFromServer(result.row);
			} else if (!result.ok) {
				await journalEntriesDb.setSyncError(result.id, result.error ?? "unknown error");
			}
		}
	}

	private async pushFileCdnUpdates(): Promise<void> {
		const rows = await filesDb.getCdnUpdatesNeedingPush();
		if (rows.length === 0) return;

		const updates = rows.map((r) => ({
			id: r.id,
			cdnUrl: r.mainUploadState === "uploaded_to_cdn" ? r.cdnUrl ?? undefined : undefined,
			thumbnailCdnUrl:
				r.thumbnailUploadState === "uploaded_to_cdn" ? r.thumbnailCdnUrl ?? undefined : undefined,
			isMainFileLost: r.isMainFileLost === true ? true : undefined,
		}));

		const res = await orpcFetch.files.pushCdnUpdates({ updates });

		for (const result of res.results) {
			const row = rows.find((r) => r.id === result.id);
			if (!row) continue;
			if (!result.ok) {
				await filesDb.setSyncError(result.id, result.error ?? "unknown error");
				continue;
			}
			// On ok, promote the per-layer state from `uploaded_to_cdn` to
			// `uploaded` for whichever layers we pushed.
			if (row.mainUploadState === "uploaded_to_cdn") {
				await filesDb.markCdnPushed(result.id, "main");
			}
			if (row.thumbnailUploadState === "uploaded_to_cdn") {
				await filesDb.markCdnPushed(result.id, "thumbnail");
			}
			await filesDb.setSyncError(result.id, null);
		}
	}
}

export const syncOrchestrator = new SyncOrchestrator();
