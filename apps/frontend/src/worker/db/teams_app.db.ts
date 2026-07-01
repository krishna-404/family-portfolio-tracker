import type { TeamAppSelectAll } from "@connected-repo/zod-schemas/team_app.zod";
import { clientDb, notifySubscribers } from "./db.manager";

/**
 * Local mirror of the `teams_app` server table. Server-authored:
 * teams are created/edited via online RPCs; this store only receives
 * rows via `pullDelta`.
 */
export const teamsAppDb = {
	async getAll(): Promise<TeamAppSelectAll[]> {
		return await clientDb.teamsApp.toArray();
	},

	async getById(id: string): Promise<TeamAppSelectAll | undefined> {
		return await clientDb.teamsApp.get(id);
	},

	async bulkUpsert(rows: TeamAppSelectAll[]): Promise<void> {
		if (rows.length === 0) return;
		await clientDb.teamsApp.bulkPut(rows);
		notifySubscribers("teamsApp");
	},

	async wipe(): Promise<void> {
		await clientDb.teamsApp.clear();
		notifySubscribers("teamsApp");
	},
};
