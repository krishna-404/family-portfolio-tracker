import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Layer 1: broker-reported holdings on a date, verbatim. Used only for
 * reconciliation against ledger-derived positions (Layer 3
 * reconciliation_diffs drive "unexplained holding" prompts) — never a source
 * of positions itself. See docs/kosh/02-domain-model.md §2.
 */
export class RawHoldingsSnapshotTable extends BaseTable {
	readonly table = "raw_holdings_snapshots";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			batchId: t.ulid().foreignKey("import_batches", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			accountId: t.ulid().foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			asOf: t.date(),
			isin: t.string(12).nullable(),
			brokerSymbol: t.string(),
			quantity: t.quantity8(),
			avgPrice: t.price4().nullable(),
			// The full original row, verbatim, for audit.
			rawRow: t.json<Record<string, unknown>>(),

			...t.timestampsAsNumbers(),
		}),
		(t) => [t.index(["batchId"]), t.index(["accountId", "asOf"])],
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
