import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Saved, ad-hoc, overlapping selections of broker accounts (e.g. "Dad+Mom",
 * "equity only"). "Whole family" is a virtual group (all accounts), not a
 * row here. See docs/kosh/02-domain-model.md §1.
 */
export class AccountGroupTable extends BaseTable {
	readonly table = "account_groups";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			name: t.string(),

			...t.timestampsAsNumbers(),
		}),
		(t) => [t.index(["familyId"])],
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
