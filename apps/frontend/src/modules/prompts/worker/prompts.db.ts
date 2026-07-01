import type { PromptSelectAll } from "@connected-repo/zod-schemas/prompt.zod";
import { clientDb, notifySubscribers } from "../../../worker/db/db.manager";

/**
 * Prompts are server-authored — the client only pulls, never pushes.
 */
export const promptsDb = {
	async getAll(): Promise<PromptSelectAll[]> {
		return await clientDb.prompts.toArray();
	},

	async getById(id: string): Promise<PromptSelectAll | undefined> {
		return await clientDb.prompts.get(id);
	},

	async bulkUpsert(rows: PromptSelectAll[]): Promise<void> {
		if (rows.length === 0) return;
		await clientDb.prompts.bulkPut(rows);
		notifySubscribers("prompts");
	},
};
