import { db } from "@backend/db/db";
import { rpcProtectedActiveTeamProcedure, rpcProtectedProcedure } from "@backend/procedures/protected.procedure";
import {
	journalEntryCreateInputZod,
	journalEntryDeleteZod,
	journalEntryGetByIdZod,
	journalEntryGetByUserZod,
	journalEntrySelectAllZod,
} from "@connected-repo/zod-schemas/journal_entry.zod";
import {
	journalEntryCreateInputWithRelationsZod,
	journalEntryPullDeltaInputZod,
	journalEntryPullDeltaOutputZod,
	journalEntryPushCreatesInputZod,
	journalEntryPushCreatesOutputZod,
	journalEntrySelectAllWithRelationsZod,
} from "@connected-repo/zod-schemas/journal-entries/sync";
import { userSelectAllZod } from "@connected-repo/zod-schemas/user.zod";
import { z } from "zod";
import { pushJournalEntryCreatesService } from "./services/push_creates.journal_entries.service";
import { pullJournalEntriesService } from "./services/sync.journal_entries.service";

// Get all journal entries for the authenticated user, optionally filtered by team
const getAll = rpcProtectedProcedure
	.input(z.object({ teamId: z.ulid().nullable().optional() }))
	.output(z.array(journalEntrySelectAllZod.extend({ author: userSelectAllZod.optional() })))
	.handler(async ({ input: { teamId }, context: { user } }) => {
		const query: any = { authorUserId: user.id };
		if (teamId !== undefined) {
			query.teamId = teamId;
		}

		const journalEntries = await db.journalEntries
			.select("*", {
				author: (t) => t.author.selectAll(),
			})
			.where(query);

		return journalEntries;
	});

// Get journal entry by ID
const getById = rpcProtectedProcedure
	.input(journalEntryGetByIdZod.extend({ teamId: z.ulid().nullable().optional() }))
	.output(journalEntrySelectAllZod)
	.handler(async ({ input: { id, teamId }, context: { user } }) => {
		const query: any = { id, authorUserId: user.id };
		if (teamId !== undefined) {
			query.teamId = teamId;
		}

		const journalEntry = await db.journalEntries
			.find(id)
			.where(query);

		return journalEntry;
	});

// Create journal entry.
//
// Accepts the SAME create-with-relations shape as `pushCreates`: parent +
// optional nested `files: FileCreateInput[]`. This keeps the online and
// offline write paths structurally identical — the `OnlineFirstAdapter`
// on the client sends the exact same payload whether it lands here
// immediately or falls back to the offline queue that flushes via
// `pushCreates`.
const create = rpcProtectedActiveTeamProcedure
	.input(journalEntryCreateInputWithRelationsZod)
	.output(journalEntrySelectAllWithRelationsZod)
	.handler(async ({ input, context: { user } }) => {
		const { files, ...parent } = input;

		await db.journalEntries
			.create({
				...parent,
				authorUserId: user.id,
				...(files?.length
					? {
							files: {
								create: files.map((f) => ({
									...f,
									tableName: "journalEntries" as const,
									type: "attachment" as const,
									createdByUserId: user.id,
								})),
							},
						}
					: {}),
			})
			.onConflictDoNothing("id");

		const [canonicalParent, canonicalFiles] = await Promise.all([
			db.journalEntries.find(input.id).selectAll(),
			db.files
				.where({ tableName: "journalEntries", type: "attachment", tableId: input.id })
				.selectAll(),
		]);

		return { ...canonicalParent, files: canonicalFiles };
	});

// Get journal entries by user
const getByUser = rpcProtectedProcedure
	.input(journalEntryGetByUserZod)
	.output(z.array(journalEntrySelectAllZod.extend({ author: userSelectAllZod.optional() })))
	.handler(async ({ input }) => {
		const journalEntries = await db.journalEntries
			.select("*", {
				author: (t) => t.author.selectAll(),
			})
			.where({ authorUserId: input.authorUserId })
			.order({ createdAt: "DESC" });

		return journalEntries;
	});

// Update journal entry
const update = rpcProtectedProcedure
	.input(journalEntryCreateInputZod.extend({ id: z.ulid() }))
	.output(journalEntrySelectAllZod)
	.handler(async ({ input, context: { user } }) => {
		const { id, ...updates } = input;
		
		const updatedJournalEntry = await db.journalEntries
			.find(id)
			.selectAll()
			.where({ authorUserId: user.id })
			.update(updates);

		return updatedJournalEntry;
	});

// Delete journal entry
const deleteEntry = rpcProtectedProcedure
	.input(journalEntryDeleteZod.extend({ teamId: z.ulid().nullable().optional() }))
	.output(z.object({ success: z.boolean() }))
	.handler(async ({ input: { id, teamId }, context: { user } }) => {
		const query: any = { id, authorUserId: user.id };
		if (teamId !== undefined) {
			query.teamId = teamId;
		}
		
		await db.journalEntries.find(id).where(query).delete();

		return { success: true };
	});

// ─── Sync ───────────────────────────────────────────────────────────────

const pushCreates = rpcProtectedActiveTeamProcedure
	.route({ method: "POST", tags: ["Journal Entries"] })
	.input(journalEntryPushCreatesInputZod)
	.output(journalEntryPushCreatesOutputZod)
	.handler(async ({ input, context: { user } }) => {
		return await pushJournalEntryCreatesService(input, user.id);
	});

const pullDelta = rpcProtectedActiveTeamProcedure
	.route({ method: "POST", tags: ["Journal Entries"] })
	.input(journalEntryPullDeltaInputZod)
	.output(journalEntryPullDeltaOutputZod)
	.handler(async ({ input, context: { user, activeTeamId } }) => {
		return await pullJournalEntriesService(input, user.id, activeTeamId);
	});

export const journalEntriesRouter = {
	getAll,
	getById,
	create,
	update,
	getByUser,
	delete: deleteEntry,
	pushCreates,
	pullDelta,
};
