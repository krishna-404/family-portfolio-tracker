import { BaseTable } from "@backend/db/base_table";
import { getRequestContext } from "@backend/lib/request-context";

/**
 * Join table: which broker accounts belong to which saved group. An account
 * may sit in many groups (overlapping selections are the point). Composite
 * PK per the domain model — no surrogate id.
 * See docs/kosh/02-domain-model.md §1.
 */
export class AccountGroupMemberTable extends BaseTable {
	readonly table = "account_group_members";

	columns = this.setColumns(
		(t) => ({
			familyId: t.koshFamilyId(),
			// Membership rows are selection metadata, not ledger data — they may
			// die with their group/account (CASCADE).
			groupId: t.ulid().foreignKey("account_groups", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			accountId: t.ulid().foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),

			...t.timestampsAsNumbers(),
		}),
		(t) => [t.primaryKey(["groupId", "accountId"]), t.index(["accountId"])],
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
