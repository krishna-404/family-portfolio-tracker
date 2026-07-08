import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Layer 1: trades exactly as the broker reported them — original symbols,
 * pre-split quantities/prices. NEVER adjusted, never edited; supersession
 * happens at the batch level. Each admitted row gets a 1:1 `trades` row via
 * a `trade_recognized` event. See docs/kosh/02-domain-model.md §2.
 */
export class RawTradeTable extends BaseTable {
	readonly table = "raw_trades";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			// RESTRICT: raw rows must never orphan their provenance batch.
			batchId: t.ulid().foreignKey("import_batches", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			accountId: t.ulid().foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			tradeDate: t.date(),
			execTime: t.timestampNumber().nullable(),
			brokerSymbol: t.string(),
			exchange: t.exchangeEnum().nullable(),
			isin: t.string(12).nullable(),
			side: t.tradeSideEnum(),
			quantity: t.quantity8(),
			price: t.price4(),
			brokerTradeId: t.string().nullable(),
			brokerOrderId: t.string().nullable(),
			// {brokerage, stt, gst, stamp_duty, exchange_txn, sebi, other} as
			// reported; null when the source (e.g. Zerodha tradebook) has none.
			charges: t.json<Record<string, unknown>>().nullable(),
			// The full original row, verbatim, for audit.
			rawRow: t.json<Record<string, unknown>>(),

			...t.timestampsAsNumbers(),
		}),
		(t) => [
			// Dedupe key where the broker supplies a trade id (spec §2); rows
			// without one fall back to a content hash at the validation gate.
			t.unique(["accountId", "brokerTradeId"], {
				name: "raw_trades_account_id_broker_trade_id_idx",
				where: "broker_trade_id IS NOT NULL",
			}),
			t.index(["batchId"]),
			t.index(["accountId", "tradeDate"]),
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
