import { z } from "zod";
import { syncDeltaInputZod, syncMetadataZod } from "../sync.zod.js";
import { teamAppMemberSelectAllZod, teamAppSelectAllZod } from "../team_app.zod.js";
import { zTimeEpoch } from "../zod_utils.js";

// ─── Wave-1 anchor ──────────────────────────────────────────────────────────
//
// `teams.pullDelta` mints `topLevelSyncedAt` as `Date.now()` and returns it
// alongside its own rows. Every downstream table pull in the same cycle
// echoes this value back so the whole cycle sees a consistent snapshot
// ceiling.

export const teamsAppPullDeltaInputZod = z.object({
	syncMetadata: syncMetadataZod.nullish(),
});
export type TeamsAppPullDeltaInput = z.infer<typeof teamsAppPullDeltaInputZod>;

export const teamsAppPullDeltaOutputZod = z.object({
	rows: z.array(teamAppSelectAllZod),
	syncMetadata: syncMetadataZod,
	topLevelSyncedAt: zTimeEpoch,
});
export type TeamsAppPullDeltaOutput = z.infer<typeof teamsAppPullDeltaOutputZod>;

// ─── Downstream anchors ─────────────────────────────────────────────────────

export const teamMembersPullDeltaInputZod = syncDeltaInputZod;
export type TeamMembersPullDeltaInput = z.infer<typeof teamMembersPullDeltaInputZod>;

export const teamMembersPullDeltaOutputZod = z.object({
	rows: z.array(teamAppMemberSelectAllZod),
	syncMetadata: syncMetadataZod,
});
export type TeamMembersPullDeltaOutput = z.infer<typeof teamMembersPullDeltaOutputZod>;
