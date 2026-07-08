import { getRequestContext } from "@backend/lib/request-context";
import { omitKeys } from "@backend/utils/omit.utils";
import {
	API_PRODUCT_REQUEST_STATUS_ENUM,
	API_REQUEST_METHOD_ENUM,
	apiProductSkuEnum,
	BROKER_ENUM,
	CASH_FLOW_CLASSIFICATION_ENUM,
	CHARGE_TYPE_ENUM,
	EVENT_KIND_ENUM,
	EXCHANGE_ENUM,
	FILE_TABLE_NAME_ENUM,
	FILE_TYPE_ENUM,
	IMPORT_BATCH_KIND_ENUM,
	IMPORT_BATCH_STATUS_ENUM,
	INSTRUMENT_ALIAS_KIND_ENUM,
	INSTRUMENT_KIND_ENUM,
	PG_TBUS_TASK_STATUS_ENUM,
	TEAM_MEMBER_ROLE_ENUM,
	THEME_SETTING_ENUM,
	TRADE_SIDE_ENUM,
	WEBHOOK_STATUS_ENUM,
} from "@connected-repo/zod-schemas/enums.zod";
import { createBaseTable } from "orchid-orm";
import { nodePostgresSchemaConfig } from "pqb/node-postgres";
import { ulid } from "ulid";

/**
 * Convert a Postgres timestamp value to microseconds-since-epoch, as a base-10
 * string. Used as the wire format for `updatedAt` on every sync-able table so
 * the two-cursor pull protocol can order rows with strict `>` / `<` semantics
 * at microsecond precision. String because JSON has no bigint and the value
 * overflows Number.MAX_SAFE_INTEGER around year 2255.
 */
export function parseMicrosecondsToEpochStr(input: unknown): string {
	if (!input) return "0";

	const dateStr = input instanceof Date ? input.toISOString() : String(input);
	const msEpoch = BigInt(Date.parse(dateStr));

	const match = dateStr.match(/\.(\d+)/);
	if (!match?.[1]) return (msEpoch * 1000n).toString();

	const fullFraction = match[1].padEnd(6, "0");
	const microsecondsStr = fullFraction.slice(3, 6);
	return (msEpoch * 1000n + BigInt(microsecondsStr)).toString();
}

/**
 * Who authored a Kosh ledger event ('system' pipeline vs interactive 'user').
 * Backend-local (not in @connected-repo/zod-schemas) because it is always
 * server-stamped, never accepted as client input.
 * TODO(kosh): move to zod-schemas if the frontend ever needs to render it.
 */
export const EVENT_ACTOR_ENUM = ["system", "user"] as const;
export type EventActor = (typeof EVENT_ACTOR_ENUM)[number];

export const BaseTable = createBaseTable({
	autoForeignKeys: false,
	nowSQL: `clock_timestamp()`,
	snakeCase: true,
	// Required since orchid-orm 1.72 when using the node-postgres adapter —
	// aligns column encoding/parsing with node-postgres's parser table.
	// Without this, types like int8/numeric/timestamp can decode as the
	// wrong runtime type (string vs number) silently.
	schemaConfig: nodePostgresSchemaConfig,

	columnTypes: (t) => ({
		...t,
		// Decimal helpers — consistent precision across price/quantity/amount columns.
		percent: () => t.decimal(5, 2),
		price: () => t.decimal(10, 2),
		quantity: () => t.decimal(11, 3),
		amount: () => t.decimal(15, 2),

		// Kosh ledger-core decimal helpers (docs/kosh/02-domain-model.md):
		// money and quantities are ALWAYS NUMERIC — never float/real.
		moneyAmount: () => t.decimal(20, 2),
		quantity8: () => t.decimal(20, 8),
		price4: () => t.decimal(20, 4),
		rate8: () => t.decimal(20, 8),

		apiProductSkuEnum: () => t.enum("api_product_enum", apiProductSkuEnum),
		brokerEnum: () => t.enum("broker_enum", BROKER_ENUM),
		cashFlowClassificationEnum: () =>
			t.enum("cash_flow_classification_enum", CASH_FLOW_CLASSIFICATION_ENUM),
		chargeTypeEnum: () => t.enum("charge_type_enum", CHARGE_TYPE_ENUM),
		eventActorEnum: () => t.enum("event_actor_enum", EVENT_ACTOR_ENUM),
		eventKindEnum: () => t.enum("event_kind_enum", EVENT_KIND_ENUM),
		exchangeEnum: () => t.enum("exchange_enum", EXCHANGE_ENUM),
		importBatchKindEnum: () =>
			t.enum("import_batch_kind_enum", IMPORT_BATCH_KIND_ENUM),
		importBatchStatusEnum: () =>
			t.enum("import_batch_status_enum", IMPORT_BATCH_STATUS_ENUM),
		instrumentAliasKindEnum: () =>
			t.enum("instrument_alias_kind_enum", INSTRUMENT_ALIAS_KIND_ENUM),
		instrumentKindEnum: () =>
			t.enum("instrument_kind_enum", INSTRUMENT_KIND_ENUM),
		tradeSideEnum: () => t.enum("trade_side_enum", TRADE_SIDE_ENUM),

		/**
		 * Tenant column for Kosh family-scoped tables (family = teams_app row;
		 * see docs/kosh/02-domain-model.md §1). Auto-stamped from the
		 * AsyncLocalStorage request context on insert, like
		 * `idAndAuditTimestamps.teamId` — NOT NULL because a ledger row without
		 * a family is meaningless. Pair with a `scopes.default` familyId filter
		 * on each table (files.table.ts pattern).
		 */
		koshFamilyId: () =>
			t
				.string(26)
				.foreignKey("teams_app", "id", {
					onUpdate: "RESTRICT",
					onDelete: "CASCADE",
				})
				.readOnly()
				.setOnCreate(() => {
					const ctx = getRequestContext();
					if (!ctx) throw new Error("No request context — cannot set familyId");
					return ctx.tenantTeamId;
				}),

		apiRequestMethodEnum: () =>
			t.enum("api_request_method_enum", API_REQUEST_METHOD_ENUM),
		apiProductRequestStatusEnum: () =>
			t.enum("api_status_enum", API_PRODUCT_REQUEST_STATUS_ENUM),
		fileTableNameEnum: () =>
			t.enum("file_table_name_enum", FILE_TABLE_NAME_ENUM),
		fileTypeEnum: () => t.enum("file_type_enum", FILE_TYPE_ENUM),
		pgTbusTaskStatusEnum: () =>
			t.enum("pg_tbus_task_status_enum", PG_TBUS_TASK_STATUS_ENUM),
		teamMemberRoleEnum: () =>
			t.enum("team_member_role_enum", TEAM_MEMBER_ROLE_ENUM),
		themeSettingEnum: () => t.enum("theme_setting_enum", THEME_SETTING_ENUM),
		timestampNumber: () => t.timestamp().asNumber(),
		ulid: () => t.string(26),
		// Client-side ULID default. WARNING: with `createMany` on a table that
		// ALSO has a `setOnCreate` column (e.g. `teamId`), orchid-orm 1.73 does
		// NOT re-evaluate this runtime default per row — every row gets the same
		// id and the insert fails with a duplicate-pkey error. So for BULK
		// inserts always pass an explicit `id` per row (as `push_creates` does
		// with client-minted ULIDs). Single `create` and `createMany` on tables
		// without a `setOnCreate` column are unaffected.
		ulidWithDefault: () => t.string(26).default(() => ulid()),
		webhookStatusEnum: () => t.enum("webhook_status_enum", WEBHOOK_STATUS_ENUM),

		/**
		 * `updatedAt` is transported as a µs-string so the pull-delta protocol
		 * can order rows with strict `>` / `<` semantics at microsecond precision.
		 * Use this on every sync-able table (files,
		 * teams_app, team_members, etc.). Auth / session / log tables that are
		 * NOT part of the sync engine can use `timestampsAsNumbers()` instead
		 * to keep the older ms-epoch shape.
		 */
		timestamps: () => ({
			createdAt: t.timestamps().createdAt.asNumber(),
			updatedAt: t.timestamps().updatedAt.parse(parseMicrosecondsToEpochStr),
		}),

		/** Legacy ms-epoch timestamps for tables outside the sync engine. */
		timestampsAsNumbers: () => ({
			createdAt: t.timestamps().createdAt.asNumber(),
			updatedAt: t.timestamps().updatedAt.asNumber(),
		}),

		/**
		 * Standard column bundle for team-scoped domain tables. Stamps `teamId`
		 * and `createdByTeamMemberId` from the AsyncLocalStorage request
		 * context on every insert, making tenant-leak bugs impossible at the
		 * ORM layer. Use `omit` to drop fields per-table where needed.
		 *
		 * `editedByTeamMemberId` is intentionally NOT readOnly/setOnCreate —
		 * routes must spread the current actor onto every .update() payload.
		 * Hook-driven cascading writes need to re-stamp it; readOnly would
		 * reject the legitimate refresh.
		 */
		idAndAuditTimestamps: <
			OmitKeys extends
				| "id"
				| "teamId"
				| "clientCreatedAt"
				| "clientEditedAt"
				| "createdByTeamMemberId"
				| "editedByTeamMemberId"
				| "deletedAt"
				| "createdAt"
				| "updatedAt" = never,
		>(options?: {
			omit?: OmitKeys[];
		}) => {
			const allFields = {
				id: t.string(26).primaryKey(),
				teamId: t
					.string(26)
					.foreignKey("teams_app", "id", {
						onUpdate: "RESTRICT",
						onDelete: "CASCADE",
					})
					.readOnly()
					.setOnCreate(() => {
						const ctx = getRequestContext();
						if (!ctx) throw new Error("No request context — cannot set teamId");
						return ctx.tenantTeamId;
					}),
				clientCreatedAt: t.timestamp().asNumber(),
				clientEditedAt: t.timestamp().nullable().asNumber(),
				createdByTeamMemberId: t
					.string(26)
					.readOnly()
					.foreignKey("team_members", "id", {
						onUpdate: "RESTRICT",
						onDelete: "SET NULL",
					})
					.setOnCreate(() => {
						const ctx = getRequestContext();
						if (!ctx)
							throw new Error(
								"No request context — cannot set createdByTeamMemberId",
							);
						return ctx.teamMemberId;
					}),
				editedByTeamMemberId: t
					.string(26)
					.nullable()
					.foreignKey("team_members", "id", {
						onUpdate: "RESTRICT",
						onDelete: "SET NULL",
					}),
				deletedAt: t.timestamp().asNumber().nullable(),
				createdAt: t.timestamps().createdAt.asNumber(),
				updatedAt: t.timestamps().updatedAt.parse(parseMicrosecondsToEpochStr),
			};

			return (
				options?.omit ? omitKeys(allFields, options.omit) : allFields
			) as Omit<typeof allFields, OmitKeys>;
		},
	}),
});

export const { sql } = BaseTable;
