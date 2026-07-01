import type { FileSelectAll } from "@connected-repo/zod-schemas/file.zod";
import type { JournalEntrySelectAll } from "@connected-repo/zod-schemas/journal_entry.zod";
import type { PromptSelectAll } from "@connected-repo/zod-schemas/prompt.zod";
import type {
	TeamAppMemberSelectAll,
	TeamAppSelectAll,
} from "@connected-repo/zod-schemas/team_app.zod";
import Dexie, { type Table } from "dexie";
import type { StoredFile, StoredSyncMetadata, SyncCycleState } from "./schema.db.types";

/**
 * Local mirror of the server's synced tables plus a small amount of
 * client-only state (cursors, file-upload machine, sync cycle telemetry).
 *
 * Pending vs confirmed rows share the same Dexie table — a row is
 * "pending" when `createdAt` is falsy (`null` / `undefined` / `0`). We
 * cast to `null` when constructing the pending row so callers can rely
 * on `createdAt === null` as the sentinel.
 *
 * Cross-context reactivity uses a hand-rolled `BroadcastChannel` (see
 * `notifySubscribers`) — Dexie's own `liveQuery` doesn't cross the
 * worker boundary, and Comlink's postMessage overhead per query is
 * higher than the broadcast.
 */

export type Pending<T extends { createdAt?: number | null }> = Omit<T, "createdAt"> & {
	createdAt: number | null;
};

export type WithSyncStatus<T extends { createdAt?: number | null }> = Pending<T> & {
	syncError?: string | null;
};

const DEXIE_VERSION = 3;
const DEXIE_DB_NAME = "app_db_v1";

export class ClientDatabase extends Dexie {
	journalEntries!: Table<WithSyncStatus<JournalEntrySelectAll>, string>;
	prompts!: Table<PromptSelectAll, string>;
	files!: Table<StoredFile, string>;
	teamsApp!: Table<TeamAppSelectAll, string>;
	teamMembers!: Table<TeamAppMemberSelectAll, string>;
	syncMetadata!: Table<StoredSyncMetadata, string>;
	syncState!: Table<SyncCycleState, string>;

	constructor() {
		super(DEXIE_DB_NAME);

		this.version(DEXIE_VERSION).stores({
			// createdAt is the pending-vs-confirmed marker (null = pending).
			// [teamId+updatedAt] powers the tezi-style two-cursor local ordering.
			journalEntries: "id, teamId, createdAt, updatedAt, syncError, [teamId+updatedAt]",
			prompts: "id, updatedAt, [updatedAt+id]",
			files: "id, tableId, tableName, type, teamId, updatedAt, mainUploadState, thumbnailUploadState, createdAt, syncError",
			teamsApp: "id, updatedAt",
			teamMembers: "id, userId, teamId, updatedAt",
			// keyed by syncedTable — one row per synced table
			syncMetadata: "syncedTable",
			// singleton — key = "app"
			syncState: "key",
		});
	}
}

export const clientDb = new ClientDatabase();

// ─── Cross-context reactivity ───────────────────────────────────────────
//
// The DataWorker mutates Dexie; the main thread reads through hooks. Both
// need to know when a table changed. `BroadcastChannel` fans out to every
// same-origin document + worker, so a single write notifies all of them.

export type AppDbTable =
	| "journalEntries"
	| "prompts"
	| "files"
	| "teamsApp"
	| "teamMembers"
	| "syncMetadata"
	| "syncState";

const dbUpdatesChannel = new BroadcastChannel("db-updates");
const subscribers = new Set<(table: AppDbTable) => void>();

dbUpdatesChannel.onmessage = (event) => {
	const table = (event.data as { table?: AppDbTable } | undefined)?.table;
	if (!table) return;
	for (const cb of subscribers) cb(table);
};

/**
 * Notify every subscriber in this context AND every other same-origin
 * context that `table` changed. Callers MUST invoke this after every
 * write, otherwise UI hooks won't refetch.
 */
export const notifySubscribers = (table: AppDbTable): void => {
	for (const cb of subscribers) cb(table);
	dbUpdatesChannel.postMessage({ table });
};

export const subscribe = (callback: (table: AppDbTable) => void): (() => void) => {
	subscribers.add(callback);
	return () => {
		subscribers.delete(callback);
	};
};

// ─── Team wipe cascade ──────────────────────────────────────────────────
//
// Called when a user leaves a team or the active team is deleted. Wipes
// every synced row scoped to that teamId. Bypasses tombstone semantics —
// this is a hard local cleanup, not a soft-delete.
export const wipeTeamData = async (teamId: string): Promise<void> => {
	await clientDb.transaction(
		"rw",
		[
			clientDb.journalEntries,
			clientDb.files,
			clientDb.teamsApp,
			clientDb.teamMembers,
			clientDb.syncMetadata,
		],
		async () => {
			await clientDb.journalEntries.where({ teamId }).delete();
			await clientDb.files.where({ teamId }).delete();
			await clientDb.teamMembers.where({ teamId }).delete();
			await clientDb.teamsApp.where({ id: teamId }).delete();
			// Also drop cursors so a fresh join re-pulls from scratch.
			await clientDb.syncMetadata.where({ teamId }).delete();
		},
	);
	notifySubscribers("journalEntries");
	notifySubscribers("files");
	notifySubscribers("teamMembers");
	notifySubscribers("teamsApp");
	notifySubscribers("syncMetadata");
};

// ─── Type aliases for module DB adapters ────────────────────────────────

export type StoredJournalEntry = WithSyncStatus<JournalEntrySelectAll>;
export type StoredPrompt = PromptSelectAll;
export type StoredTeam = TeamAppSelectAll;
export type StoredTeamMember = TeamAppMemberSelectAll;

export type { FileSelectAll };
