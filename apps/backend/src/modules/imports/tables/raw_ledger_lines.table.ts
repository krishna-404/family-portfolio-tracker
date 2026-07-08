import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Layer 1: broker funds-statement lines, verbatim — the fund-flow source.
 * Classification into cash_flows happens at Layer 2 via
 * `cash_flow_classified` events; this table is never edited.
 * See docs/kosh/02-domain-model.md §2.
 */
export class RawLedgerLineTable extends BaseTable {
	readonly table = "raw_ledger_lines";

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
			postedDate: t.date(),
			valueDate: t.date().nullable(),
			narration: t.text(),
			debit: t.moneyAmount().nullable(),
			credit: t.moneyAmount().nullable(),
			runningBalance: t.moneyAmount().nullable(),
			brokerVoucherId: t.string().nullable(),
			// The full original row, verbatim, for audit.
			rawRow: t.json<Record<string, unknown>>(),
			// False once this row's batch is retracted (rows are never deleted);
			// keeps retracted lines out of dedupe. See migration 0010.
			isLive: t.boolean().default(true),

			...t.timestampsAsNumbers(),
		}),
		(t) => [
			t.index(["batchId"]),
			t.index(["accountId", "postedDate"]),
			t.index(["accountId", "isLive"]),
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
