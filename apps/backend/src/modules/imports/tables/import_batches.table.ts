import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * One row per uploaded statement / manual-entry batch — the provenance root
 * of every Layer-1 raw row. Batches are applied atomically or not at all,
 * and are never edited: a re-upload SUPERSEDES an older batch
 * (supersededByBatchId), and retraction is an event (retractionEventId)
 * that supersedes the batch as a unit. See docs/kosh/02-domain-model.md §2
 * and 01-architecture.md §3 (retraction mechanics).
 */
export class ImportBatchTable extends BaseTable {
	readonly table = "import_batches";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			accountId: t.ulid().foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			kind: t.importBatchKindEnum(),
			// Verbatim upload via the files module; null for manual entry.
			fileId: t
				.ulid()
				.foreignKey("files", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			// e.g. 'casparser 1.3.0' for CAS JSON produced by the wrapped CLI.
			sourceTool: t.string().nullable(),
			status: t.importBatchStatusEnum(),
			// SHA-256 hex of the uploaded content — dedupe key for re-uploads.
			contentSha256: t.string(64),
			uploadedByUserId: t.uuid().foreignKey("users", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			appliedAt: t.timestampNumber().nullable(),
			supersededByBatchId: t
				.ulid()
				.foreignKey("import_batches", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			// Set when the batch is retracted; the event carries reason + actor.
			retractionEventId: t
				.ulid()
				.foreignKey("events", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			// Row counts, date span, dedupe summary. Null until parsing produces
			// them (spec leaves the pre-parse shape undefined).
			stats: t.json<Record<string, unknown>>().nullable(),

			...t.timestampsAsNumbers(),
		}),
		(t) => [
			t.index(["familyId", "accountId"]),
			// Fast "have we seen this exact file before?" lookup.
			t.index(["contentSha256"]),
		],
	);

	// Default tenant scope (family = team). Bypass with `.unscope('default')`
	// where a cross-tenant read is genuinely required.
	scopes = this.setScopes({
		default: (q) => {
			const ctx = getRequestContext();
			return ctx ? q.where({ familyId: ctx.tenantTeamId }) : q;
		},
	});
}
