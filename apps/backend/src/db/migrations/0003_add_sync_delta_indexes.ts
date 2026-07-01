import { change } from "../db_script";

/**
 * Composite indexes to power the two-cursor pull-delta protocol.
 *
 * Every synced pull query orders by `(updatedAt DESC, id DESC)` and filters
 * either by tenant (`teamId` or `id` on `teams_app`) or globally (`prompts`).
 * The composite index makes the ordered walk plan-only — no sort node,
 * no re-check.
 *
 * `prompts` is a global (untenanted) table, so its index is 2-column.
 * `teams_app` is scoped by row `id` (a tenant IS a teams_app row), so its
 * composite is `(id, updated_at)`.
 */
change(async (db) => {
	await db.addIndex(
		"teams_app",
		["id", { column: "updated_at", order: "DESC" }],
		{ name: "teams_app_sync_delta_idx" },
	);

	await db.addIndex(
		"team_members",
		[
			"team_id",
			{ column: "updated_at", order: "DESC" },
			{ column: "id", order: "DESC" },
		],
		{ name: "team_members_sync_delta_idx" },
	);

	await db.addIndex(
		"prompts",
		[
			{ column: "updated_at", order: "DESC" },
			{ column: "id", order: "DESC" },
		],
		{ name: "prompts_sync_delta_idx" },
	);

	await db.addIndex(
		"journal_entries",
		[
			"team_id",
			{ column: "updated_at", order: "DESC" },
			{ column: "id", order: "DESC" },
		],
		{ name: "journal_entries_sync_delta_idx" },
	);

	await db.addIndex(
		"files",
		[
			"team_id",
			{ column: "updated_at", order: "DESC" },
			{ column: "id", order: "DESC" },
		],
		{ name: "files_sync_delta_idx" },
	);
});
