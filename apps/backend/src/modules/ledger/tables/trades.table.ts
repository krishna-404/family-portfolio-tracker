import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Layer 2: the validated, instrument-resolved view of raw_trades — strictly
 * 1:1 (rawTradeId UNIQUE) and immutable once recognized via a
 * `trade_recognized` event. Amounts denormalize the charge units:
 * totalCharges = Σ trade_charge_units.amount; net_value = gross+charges on
 * buys, gross−charges on sells (service-layer invariants).
 * See docs/kosh/02-domain-model.md §5.
 */
export class TradeTable extends BaseTable {
	readonly table = "trades";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			rawTradeId: t
				.ulid()
				.foreignKey("raw_trades", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.unique(),
			accountId: t.ulid().foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			instrumentId: t.ulid().foreignKey("instruments", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			tradeDate: t.date(),
			side: t.tradeSideEnum(),
			quantity: t.quantity8(),
			price: t.price4(),
			grossValue: t.moneyAmount(),
			totalCharges: t.moneyAmount(),
			netValue: t.moneyAmount(),
			recognizedEventId: t.ulid().foreignKey("events", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),

			...t.timestampsAsNumbers(),
		}),
		(t) => [t.index(["accountId", "tradeDate"]), t.index(["instrumentId"])],
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
