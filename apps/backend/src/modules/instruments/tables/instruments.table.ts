import { BaseTable } from "@backend/db/base_table";

/**
 * Layer 2 instrument master: one row per economic asset, stable across
 * name/symbol changes (renames land in instrument_aliases; identity across
 * corporate events lands in instrument_links, a later milestone). GLOBAL
 * reference data — deliberately not family-scoped.
 * See docs/kosh/02-domain-model.md §3.
 */
export class InstrumentTable extends BaseTable {
	readonly table = "instruments";

	columns = this.setColumns((t) => ({
		id: t.ulidWithDefault().primaryKey(),
		kind: t.instrumentKindEnum(),
		// Equities/ETFs/MF/bonds; null for crypto/index. ISIN wins over every
		// other resolution path.
		isin: t.string(12).unique().nullable(),
		// Current primary symbol (or coin ticker / index name).
		symbolCanonical: t.string(),
		name: t.string(),
		// Quote currency (INR; USD for US stocks; etc.).
		currency: t.string(3),
		// 'NSE', 'NYSE', '24x7' (crypto).
		exchangeCalendar: t.string().nullable(),
		amfiCode: t.string().nullable(),

		...t.timestampsAsNumbers(),
	}));
}
