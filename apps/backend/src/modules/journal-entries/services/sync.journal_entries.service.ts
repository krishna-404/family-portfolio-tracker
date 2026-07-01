import { db } from "@backend/db/db";
import { syncDeltaService } from "@backend/modules/sync/services/sync_delta.sync.service";
import type { JournalEntrySelectAll } from "@connected-repo/zod-schemas/journal_entry.zod";
import type {
	JournalEntryPullDeltaInput,
	JournalEntryPullDeltaOutput,
} from "@connected-repo/zod-schemas/journal-entries/sync";

/**
 * Scope: rows authored by the calling user within the active tenant team.
 * Journal entries carry both `authorUserId` and `teamId`; sync filters by
 * both so a team member sees only their own entries plus any team-scoped
 * ones they created.
 */
export async function pullJournalEntriesService(
	input: JournalEntryPullDeltaInput,
	authorUserId: string,
	tenantTeamId: string,
): Promise<JournalEntryPullDeltaOutput> {
	const baseQuery = db.journalEntries.where({ authorUserId, teamId: tenantTeamId });

	const { data, syncMetadata } = await syncDeltaService<JournalEntrySelectAll>({
		// biome-ignore lint/suspicious/noExplicitAny: __scopes generic mismatch when narrowing bare table query
		baseQuery: baseQuery as any,
		syncMetadataInput: input.syncMetadata,
		topLevelSyncedAt: input.topLevelSyncedAt,
		syncedTable: "journalEntries",
	});

	return { rows: data, syncMetadata };
}
