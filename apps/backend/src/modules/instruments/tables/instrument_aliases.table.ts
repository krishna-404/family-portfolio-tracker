import { BaseTable } from "@backend/db/base_table";

/**
 * Time-ranged symbol/name identities for an instrument (renames, per-broker
 * symbols, old ISINs). Resolution order: broker_symbol+broker → alias →
 * instrument; ISIN wins over everything. GLOBAL reference data —
 * deliberately not family-scoped. See docs/kosh/02-domain-model.md §3.
 */
export class InstrumentAliasTable extends BaseTable {
	readonly table = "instrument_aliases";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			instrumentId: t.ulid().foreignKey("instruments", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			alias: t.string(),
			aliasKind: t.instrumentAliasKindEnum(),
			// Set for alias_kind='broker_symbol' — which broker calls it this.
			broker: t.brokerEnum().nullable(),
			validFrom: t.date().nullable(),
			validTo: t.date().nullable(),

			...t.timestampsAsNumbers(),
		}),
		(t) => [
			// The resolution lookup: "what instrument is this symbol?"
			t.index(["aliasKind", "alias"]),
			t.index(["instrumentId"]),
		],
	);
}
