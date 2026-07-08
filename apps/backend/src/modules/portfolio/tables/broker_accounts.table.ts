import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * One row per (person, broker) trading/demat account. The unit every import
 * batch, raw row, trade and cash flow hangs off. An account belongs to
 * exactly one person; account_groups model arbitrary overlapping subsets.
 * See docs/kosh/02-domain-model.md §1.
 */
export class BrokerAccountTable extends BaseTable {
	readonly table = "broker_accounts";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			// RESTRICT: a person with accounts cannot be removed — the ledger
			// hanging off the account must not lose its subject.
			personId: t.ulid().foreignKey("persons", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			broker: t.brokerEnum(),
			label: t.string(),
			baseCurrency: t.string(3).default("INR"),
			// 'file_drop' | 'api' — 'api' reserved for a later phase.
			// TODO(kosh): promote to enum (missing from zod-schemas/enums.zod).
			connectionMethod: t.string(20).default("file_drop"),
			openedAt: t.date().nullable(),
			closedAt: t.date().nullable(),

			...t.timestampsAsNumbers(),
		}),
		(t) => [t.index(["familyId", "personId"])],
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
