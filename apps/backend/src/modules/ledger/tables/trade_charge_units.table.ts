import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Itemized, Portfolio-Performance-style charge units on a trade (brokerage,
 * STT, GST, ...). forexAmount/exchangeRate carry the original-currency leg
 * for foreign trades; invariant `forex_amount × exchange_rate ≈ amount`
 * (within tolerance) is checked at the service layer.
 * See docs/kosh/02-domain-model.md §5.
 */
export class TradeChargeUnitTable extends BaseTable {
	readonly table = "trade_charge_units";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			tradeId: t.ulid().foreignKey("trades", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			chargeType: t.chargeTypeEnum(),
			amount: t.moneyAmount(),
			currency: t.string(3),
			forexAmount: t.price4().nullable(),
			exchangeRate: t.rate8().nullable(),

			...t.timestampsAsNumbers(),
		}),
		(t) => [t.index(["tradeId"])],
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
