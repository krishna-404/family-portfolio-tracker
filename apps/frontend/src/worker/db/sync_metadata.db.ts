import type { TablesToSync } from "@connected-repo/zod-schemas/enums.zod";
import type { SyncMetadata } from "@connected-repo/zod-schemas/sync.zod";
import { clientDb, notifySubscribers } from "./db.manager";
import type { StoredSyncMetadata, SyncCycleState } from "./schema.db.types";

/**
 * Persistent cursor store keyed by `syncedTable`. Also holds the app-wide
 * `syncState` singleton (last successful cycle, last error).
 */
export const syncMetadataDb = {
	async getCursor(syncedTable: TablesToSync): Promise<StoredSyncMetadata | undefined> {
		return await clientDb.syncMetadata.get(syncedTable);
	},

	async saveCursor(syncedTable: TablesToSync, meta: SyncMetadata): Promise<void> {
		const existing = await clientDb.syncMetadata.get(syncedTable);
		const next: StoredSyncMetadata = {
			...meta,
			lastTopLevelSyncedAt: existing?.lastTopLevelSyncedAt ?? null,
		};
		await clientDb.syncMetadata.put(next, syncedTable);
		notifySubscribers("syncMetadata");
	},

	async saveTopLevelSyncedAt(topLevelSyncedAt: number): Promise<void> {
		const existing = await clientDb.syncMetadata.get("teamsApp");
		if (existing) {
			await clientDb.syncMetadata.put(
				{ ...existing, lastTopLevelSyncedAt: topLevelSyncedAt },
				"teamsApp",
			);
			notifySubscribers("syncMetadata");
		}
	},

	async getLastTopLevelSyncedAt(): Promise<number | null> {
		const meta = await clientDb.syncMetadata.get("teamsApp");
		return meta?.lastTopLevelSyncedAt ?? null;
	},

	async getCycleState(): Promise<SyncCycleState | undefined> {
		return await clientDb.syncState.get("app");
	},

	async saveCycleState(patch: Partial<Omit<SyncCycleState, "key">>): Promise<void> {
		const existing = (await clientDb.syncState.get("app")) ?? { key: "app" as const };
		await clientDb.syncState.put({ ...existing, ...patch, key: "app" });
		notifySubscribers("syncState");
	},

	async wipeAll(): Promise<void> {
		await clientDb.syncMetadata.clear();
		await clientDb.syncState.clear();
		notifySubscribers("syncMetadata");
		notifySubscribers("syncState");
	},
};
