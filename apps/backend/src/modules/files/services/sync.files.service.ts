import { db } from "@backend/db/db";
import { syncDeltaService } from "@backend/modules/sync/services/sync_delta.sync.service";
import type { FileSelectAll } from "@connected-repo/zod-schemas/file.zod";
import type {
	FilePullDeltaInput,
	FilePullDeltaOutput,
	FilePushCdnUpdateResult,
	FilePushCdnUpdatesInput,
	FilePushCdnUpdatesOutput,
} from "@connected-repo/zod-schemas/files/sync";

/**
 * Patch `cdnUrl` / `thumbnailCdnUrl` / `isMainFileLost` on file rows the
 * device already created on the server. Called by the FileUploadWorker
 * after its CDN PUT succeeds.
 *
 * Locks every requested row inside one transaction (`forUpdate`), buckets
 * the patches by field, then writes each bucket. Cross-device concurrency:
 * URL fields are only written if the server column is still null — a
 * completed upload from another device cannot be clobbered. `isMainFileLost`
 * is a one-way flip.
 */
export async function pushFilesCdnUpdatesService(
	input: FilePushCdnUpdatesInput,
): Promise<FilePushCdnUpdatesOutput> {
	if (input.updates.length === 0) return { results: [] };

	const ids = input.updates.map((u) => u.id);

	const patchedIds = new Set<string>();
	const missingIds = new Set<string>();

	await db.$transaction(async () => {
		const existing = await db.files
			.where({ id: { in: ids } })
			.forUpdate()
			.selectAll();
		const byId = new Map<string, FileSelectAll>(
			existing.map((r) => [r.id, r as FileSelectAll]),
		);

		for (const patch of input.updates) {
			const current = byId.get(patch.id);
			if (!current) {
				missingIds.add(patch.id);
				continue;
			}
			patchedIds.add(patch.id);

			const cols: Record<string, unknown> = {};

			if (patch.cdnUrl && current.cdnUrl == null) {
				cols.cdnUrl = patch.cdnUrl;
			}
			if (patch.thumbnailCdnUrl && current.thumbnailCdnUrl == null) {
				cols.thumbnailCdnUrl = patch.thumbnailCdnUrl;
			}
			if (patch.isMainFileLost === true && current.isMainFileLost === false) {
				cols.isMainFileLost = true;
			}

			if (Object.keys(cols).length > 0) {
				await db.files.find(patch.id).update(cols);
			}
		}
	});

	const canonical = await db.files.where({ id: { in: Array.from(patchedIds) } }).selectAll();
	const canonicalById = new Map(canonical.map((r) => [r.id, r as FileSelectAll]));

	const results: FilePushCdnUpdateResult[] = input.updates.map((u) => {
		if (missingIds.has(u.id)) {
			return {
				ok: false,
				id: u.id,
				error: "File row not found — parent bundle likely hasn't landed yet",
			};
		}
		const row = canonicalById.get(u.id);
		if (!row) {
			return { ok: false, id: u.id, error: "Row missing after update" };
		}
		return { ok: true, id: u.id, row };
	});

	return { results };
}

export async function pullFilesService(
	input: FilePullDeltaInput,
	tenantTeamId: string,
): Promise<FilePullDeltaOutput> {
	const baseQuery = db.files.where({ teamId: tenantTeamId });

	const { data, syncMetadata } = await syncDeltaService<FileSelectAll>({
		// biome-ignore lint/suspicious/noExplicitAny: __scopes generic mismatch when narrowing bare table query
		baseQuery: baseQuery as any,
		syncMetadataInput: input.syncMetadata,
		topLevelSyncedAt: input.topLevelSyncedAt,
		syncedTable: "files",
	});

	return { rows: data, syncMetadata };
}
