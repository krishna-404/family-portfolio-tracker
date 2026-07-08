import { z } from "zod";

export const API_PRODUCT_REQUEST_STATUS_ENUM = ["AI Error", "Invalid API route", "No active subscription", "Requests exhausted", "Pending", "Server Error", "Success"] as const;
export const apiProductRequestStatusZod = z.enum(API_PRODUCT_REQUEST_STATUS_ENUM);
export type ApiProductRequestStaus = z.infer<typeof apiProductRequestStatusZod>;

export const API_PRODUCTS = [
  {
    apiRoute: "portfolio",
    name: "Portfolio Read",
    sku: "portfolio_read",
    unitSize: 100,
    validityDays: 30,
  }
]as const;
export const apiProductSkuEnum = API_PRODUCTS.map(product => product.sku) as ["portfolio_read"];
export const apiProductSkuZod = z.enum(apiProductSkuEnum);
export type ApiProductSku = z.infer<typeof apiProductSkuZod>;

export const API_REQUEST_METHOD_ENUM = ["GET", "POST", "PUT", "DELETE"] as const;
export const apiRequestMethodZod = z.enum(API_REQUEST_METHOD_ENUM);
export type ApiRequestMethod = z.infer<typeof apiRequestMethodZod>;

export const FILE_TABLE_NAME_ENUM = ["importBatches"] as const;
export const fileTableNameZod = z.enum(FILE_TABLE_NAME_ENUM);
export type FileTableName = z.infer<typeof fileTableNameZod>;

export const FILE_TYPE_ENUM = ["attachment"] as const;
export const fileTypeZod = z.enum(FILE_TYPE_ENUM);
export type FileType = z.infer<typeof fileTypeZod>;

export const TEAM_MEMBER_ROLE_ENUM = ["Owner", "Admin", "Member"] as const;
export const teamMemberRoleZod = z.enum(TEAM_MEMBER_ROLE_ENUM);
export type TeamMemberRole = z.infer<typeof teamMemberRoleZod>;

export const THEME_SETTING_ENUM = ["dark", "light", "system"] as const;
export const themeSettingZod = z.enum(THEME_SETTING_ENUM);
export type ThemeSetting = z.infer<typeof themeSettingZod>;

export const WEBHOOK_STATUS_ENUM = ["Pending", "Sent", "Failed"] as const;
export const webhookStatusZod = z.enum(WEBHOOK_STATUS_ENUM);
export type WebhookStatus = z.infer<typeof webhookStatusZod>;

export const PG_TBUS_TASK_STATUS_ENUM = ["pending", "active", "completed", "failed", "cancelled"] as const;
export const pgTbusTaskStatusZod = z.enum(PG_TBUS_TASK_STATUS_ENUM);
export type PgTbusTaskStatus = z.infer<typeof pgTbusTaskStatusZod>;

export const FEATURE_FLAG_SCOPE_ENUM = ["global", "team"] as const;
export const featureFlagScopeZod = z.enum(FEATURE_FLAG_SCOPE_ENUM);
export type FeatureFlagScope = z.infer<typeof featureFlagScopeZod>;

export const TABLES_TO_SYNC_ENUM = [
	"teamsApp",
	"teamMembers",
	"files",
] as const;
export const tablesToSyncZod = z.enum(TABLES_TO_SYNC_ENUM);
export type TablesToSync = z.infer<typeof tablesToSyncZod>;

// Device platform reported by the frontend at push-register time.
// Broad enough to cover every OS a Web Push subscription can originate
// from, with `other` as a catchall so unknown UAs don't fail validation.
// Extend as new platforms show up (visionos, harmonyos, fireos, etc.).
export const DEVICE_PLATFORM_ENUM = [
	"ios",
	"android",
	"macos",
	"windows",
	"linux",
	"chromeos",
	"other",
] as const;
export const devicePlatformZod = z.enum(DEVICE_PLATFORM_ENUM);
export type DevicePlatform = z.infer<typeof devicePlatformZod>;

// Why a push_devices row was soft-deleted. Separates voluntary churn
// (user toggled off / logged out) from involuntary (upstream pruned).
// Extend as new detachment paths land (e.g. "browser_rotated" when we
// handle pushsubscriptionchange server-side).
export const DEVICE_DEACTIVATION_REASON_ENUM = [
	"user_revoked",
	"novu_pruned",
	"subscriber_deleted",
] as const;
export const deviceDeactivationReasonZod = z.enum(
	DEVICE_DEACTIVATION_REASON_ENUM,
);
export type DeviceDeactivationReason = z.infer<
	typeof deviceDeactivationReasonZod
>;

// ─── Kosh (family portfolio tracker) enums ──────────────────────────────

export const BROKER_ENUM = ["zerodha", "dhan", "groww", "manual"] as const;
export const brokerZod = z.enum(BROKER_ENUM);
export type Broker = z.infer<typeof brokerZod>;

export const EXCHANGE_ENUM = ["NSE", "BSE", "other"] as const;
export const exchangeZod = z.enum(EXCHANGE_ENUM);
export type Exchange = z.infer<typeof exchangeZod>;

export const TRADE_SIDE_ENUM = ["buy", "sell"] as const;
export const tradeSideZod = z.enum(TRADE_SIDE_ENUM);
export type TradeSide = z.infer<typeof tradeSideZod>;

// Authoritative charge taxonomy, from Zerodha P&L statement account heads
// (docs/research/broker-exports.md §4). Extend as other brokers surface
// new heads — never lump into "other" when the statement names the charge.
export const CHARGE_TYPE_ENUM = [
	"brokerage",
	"stt",
	"exchange_txn",
	"gst",
	"stamp_duty",
	"sebi_fee",
	"ipft",
	"clearing",
	"dp_charge",
	"amc",
	"other",
] as const;
export const chargeTypeZod = z.enum(CHARGE_TYPE_ENUM);
export type ChargeType = z.infer<typeof chargeTypeZod>;

// The ground-truth table's classification. ONLY external_deposit and
// external_withdrawal enter money-weighted return math; every other value
// must be explicitly internal (see docs/kosh/03-metrics-spec.md §1 —
// finance-math refuses to compute over unmapped classifications).
export const CASH_FLOW_CLASSIFICATION_ENUM = [
	"external_deposit",
	"external_withdrawal",
	"internal_transfer",
	"dividend_receipt",
	"fee_external",
	"trade_settlement",
	"charge",
	"interest",
	"other_internal",
] as const;
export const cashFlowClassificationZod = z.enum(CASH_FLOW_CLASSIFICATION_ENUM);
export type CashFlowClassification = z.infer<typeof cashFlowClassificationZod>;

export const IMPORT_BATCH_KIND_ENUM = [
	"tradebook",
	"ledger",
	"holdings",
	"contract_note",
	"cas",
	"manual_entry",
] as const;
export const importBatchKindZod = z.enum(IMPORT_BATCH_KIND_ENUM);
export type ImportBatchKind = z.infer<typeof importBatchKindZod>;

export const IMPORT_BATCH_STATUS_ENUM = [
	"parsing",
	"validating",
	"preview",
	"applied",
	"rejected",
	"retracted",
] as const;
export const importBatchStatusZod = z.enum(IMPORT_BATCH_STATUS_ENUM);
export type ImportBatchStatus = z.infer<typeof importBatchStatusZod>;

export const EVENT_KIND_ENUM = [
	"trade_recognized",
	"cash_flow_classified",
	"corporate_action_applied",
	"dividend_expected",
	"dividend_receipt_confirmed",
	"fee_schedule_set",
	"fee_charged",
	"user_resolution",
	"retraction",
] as const;
export const eventKindZod = z.enum(EVENT_KIND_ENUM);
export type EventKind = z.infer<typeof eventKindZod>;

export const INSTRUMENT_KIND_ENUM = [
	"equity",
	"etf",
	"mf",
	"bond",
	"sgb",
	"reit_invit",
	"crypto",
	"fx_pair",
	"index",
	"commodity",
] as const;
export const instrumentKindZod = z.enum(INSTRUMENT_KIND_ENUM);
export type InstrumentKind = z.infer<typeof instrumentKindZod>;

export const INSTRUMENT_ALIAS_KIND_ENUM = [
	"nse_symbol",
	"bse_code",
	"broker_symbol",
	"name",
	"old_isin",
] as const;
export const instrumentAliasKindZod = z.enum(INSTRUMENT_ALIAS_KIND_ENUM);
export type InstrumentAliasKind = z.infer<typeof instrumentAliasKindZod>;
