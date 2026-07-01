import type { TeamAppMemberSelectAll } from "@connected-repo/zod-schemas/team_app.zod";
import { clientDb, notifySubscribers } from "./db.manager";

export const teamMembersDb = {
	async getAllForTeam(teamId: string): Promise<TeamAppMemberSelectAll[]> {
		return await clientDb.teamMembers.where({ teamId }).toArray();
	},

	async bulkUpsert(rows: TeamAppMemberSelectAll[]): Promise<void> {
		if (rows.length === 0) return;
		await clientDb.teamMembers.bulkPut(rows);
		notifySubscribers("teamMembers");
	},
};
