import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Family members as portfolio subjects — NOT logins (a person may never sign
 * in; logins live in `users`/`team_members`). Every broker account belongs to
 * exactly one person. See docs/kosh/02-domain-model.md §1.
 */
export class PersonTable extends BaseTable {
	readonly table = "persons";

	columns = this.setColumns(
		(t) => ({
			id: t.ulidWithDefault().primaryKey(),
			familyId: t.koshFamilyId(),
			displayName: t.string(),

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
