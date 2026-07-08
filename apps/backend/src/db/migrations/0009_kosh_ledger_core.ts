import {
	BROKER_ENUM,
	CASH_FLOW_CLASSIFICATION_ENUM,
	CHARGE_TYPE_ENUM,
	EVENT_KIND_ENUM,
	EXCHANGE_ENUM,
	IMPORT_BATCH_KIND_ENUM,
	IMPORT_BATCH_STATUS_ENUM,
	INSTRUMENT_ALIAS_KIND_ENUM,
	INSTRUMENT_KIND_ENUM,
	TRADE_SIDE_ENUM,
} from "@connected-repo/zod-schemas/enums.zod";
import { EVENT_ACTOR_ENUM } from "../base_table";
import { change } from "../db_script";

// Kosh M1 ledger core: Layer-1 (raw imports) + Layer-2 (events, instruments,
// ledger) tables per docs/kosh/02-domain-model.md. Immutability is by
// convention + supersession (retraction events / superseding batches), so
// these tables carry NO soft-delete column; `family_id` (→ teams_app) is the
// tenant on everything except the global instrument master.
change(async (db) => {
	await db.createEnum("broker_enum", [...BROKER_ENUM]);
	await db.createEnum("exchange_enum", [...EXCHANGE_ENUM]);
	await db.createEnum("trade_side_enum", [...TRADE_SIDE_ENUM]);
	await db.createEnum("charge_type_enum", [...CHARGE_TYPE_ENUM]);
	await db.createEnum("cash_flow_classification_enum", [
		...CASH_FLOW_CLASSIFICATION_ENUM,
	]);
	await db.createEnum("import_batch_kind_enum", [...IMPORT_BATCH_KIND_ENUM]);
	await db.createEnum("import_batch_status_enum", [
		...IMPORT_BATCH_STATUS_ENUM,
	]);
	await db.createEnum("event_kind_enum", [...EVENT_KIND_ENUM]);
	await db.createEnum("event_actor_enum", [...EVENT_ACTOR_ENUM]);
	await db.createEnum("instrument_kind_enum", [...INSTRUMENT_KIND_ENUM]);
	await db.createEnum("instrument_alias_kind_enum", [
		...INSTRUMENT_ALIAS_KIND_ENUM,
	]);

	// ── People, accounts, groups ────────────────────────────────────────────

	await db.createTable(
		"persons",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			displayName: t.string(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => t.index(["familyId"]),
	);

	await db.createTable(
		"broker_accounts",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			personId: t.string(26).foreignKey("persons", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			broker: t.enum("broker_enum"),
			label: t.string(),
			baseCurrency: t.string(3).default("INR"),
			// TODO(kosh): promote to enum — 'file_drop' | 'api'.
			connectionMethod: t.string(20).default("file_drop"),
			openedAt: t.date().nullable(),
			closedAt: t.date().nullable(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => t.index(["familyId", "personId"]),
	);

	await db.createTable(
		"account_groups",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			name: t.string(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => t.index(["familyId"]),
	);

	await db.createTable(
		"account_group_members",
		(t) => ({
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			groupId: t.string(26).foreignKey("account_groups", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			accountId: t.string(26).foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [t.primaryKey(["groupId", "accountId"]), t.index(["accountId"])],
	);

	// ── Layer 2: instruments (global reference data — no family_id) ─────────

	await db.createTable("instruments", (t) => ({
		id: t.string(26).primaryKey(),
		kind: t.enum("instrument_kind_enum"),
		isin: t.string(12).unique().nullable(),
		symbolCanonical: t.string(),
		name: t.string(),
		currency: t.string(3),
		exchangeCalendar: t.string().nullable(),
		amfiCode: t.string().nullable(),
		createdAt: t.timestamps().createdAt,
		updatedAt: t.timestamps().updatedAt,
	}));

	await db.createTable(
		"instrument_aliases",
		(t) => ({
			id: t.string(26).primaryKey(),
			instrumentId: t.string(26).foreignKey("instruments", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			alias: t.string(),
			aliasKind: t.enum("instrument_alias_kind_enum"),
			broker: t.enum("broker_enum").nullable(),
			validFrom: t.date().nullable(),
			validTo: t.date().nullable(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [t.index(["aliasKind", "alias"]), t.index(["instrumentId"])],
	);

	// ── Layer 2: the event log (append-only spine) ──────────────────────────

	await db.createTable(
		"events",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			kind: t.enum("event_kind_enum"),
			payload: t.json(),
			actor: t.enum("event_actor_enum"),
			userId: t
				.uuid()
				.foreignKey("users", "id", {
					onUpdate: "RESTRICT",
					onDelete: "SET NULL",
				})
				.nullable(),
			occurredAt: t.timestamp(),
			recordedAt: t.timestamp().default(t.sql`now()`),
			retractsEventId: t
				.string(26)
				.foreignKey("events", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			supersededByEventId: t
				.string(26)
				.foreignKey("events", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			reason: t.text().nullable(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [t.index(["familyId", "kind"]), t.index(["familyId", "occurredAt"])],
	);

	// ── Layer 1: raw imports ────────────────────────────────────────────────

	await db.createTable(
		"import_batches",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			accountId: t.string(26).foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			kind: t.enum("import_batch_kind_enum"),
			fileId: t
				.string(26)
				.foreignKey("files", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			sourceTool: t.string().nullable(),
			status: t.enum("import_batch_status_enum"),
			contentSha256: t.string(64),
			uploadedByUserId: t.uuid().foreignKey("users", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			appliedAt: t.timestamp().nullable(),
			supersededByBatchId: t
				.string(26)
				.foreignKey("import_batches", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			retractionEventId: t
				.string(26)
				.foreignKey("events", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			stats: t.json().nullable(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [t.index(["familyId", "accountId"]), t.index(["contentSha256"])],
	);

	await db.createTable(
		"raw_trades",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			batchId: t.string(26).foreignKey("import_batches", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			accountId: t.string(26).foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			tradeDate: t.date(),
			execTime: t.timestamp().nullable(),
			brokerSymbol: t.string(),
			exchange: t.enum("exchange_enum").nullable(),
			isin: t.string(12).nullable(),
			side: t.enum("trade_side_enum"),
			quantity: t.decimal(20, 8),
			price: t.decimal(20, 4),
			brokerTradeId: t.string().nullable(),
			brokerOrderId: t.string().nullable(),
			charges: t.json().nullable(),
			rawRow: t.json(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [
			t.unique(["accountId", "brokerTradeId"], {
				name: "raw_trades_account_id_broker_trade_id_idx",
				where: "broker_trade_id IS NOT NULL",
			}),
			t.index(["batchId"]),
			t.index(["accountId", "tradeDate"]),
		],
	);

	await db.createTable(
		"raw_ledger_lines",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			batchId: t.string(26).foreignKey("import_batches", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			accountId: t.string(26).foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			postedDate: t.date(),
			valueDate: t.date().nullable(),
			narration: t.text(),
			debit: t.decimal(20, 2).nullable(),
			credit: t.decimal(20, 2).nullable(),
			runningBalance: t.decimal(20, 2).nullable(),
			brokerVoucherId: t.string().nullable(),
			rawRow: t.json(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [t.index(["batchId"]), t.index(["accountId", "postedDate"])],
	);

	await db.createTable(
		"raw_holdings_snapshots",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			batchId: t.string(26).foreignKey("import_batches", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			accountId: t.string(26).foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			asOf: t.date(),
			isin: t.string(12).nullable(),
			brokerSymbol: t.string(),
			quantity: t.decimal(20, 8),
			avgPrice: t.decimal(20, 4).nullable(),
			rawRow: t.json(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [t.index(["batchId"]), t.index(["accountId", "asOf"])],
	);

	// ── Layer 2: the ledger (ground truth for returns) ──────────────────────

	await db.createTable(
		"trades",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			rawTradeId: t
				.string(26)
				.foreignKey("raw_trades", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.unique(),
			accountId: t.string(26).foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			instrumentId: t.string(26).foreignKey("instruments", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			tradeDate: t.date(),
			side: t.enum("trade_side_enum"),
			quantity: t.decimal(20, 8),
			price: t.decimal(20, 4),
			grossValue: t.decimal(20, 2),
			totalCharges: t.decimal(20, 2),
			netValue: t.decimal(20, 2),
			recognizedEventId: t.string(26).foreignKey("events", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [t.index(["accountId", "tradeDate"]), t.index(["instrumentId"])],
	);

	await db.createTable(
		"trade_charge_units",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			tradeId: t.string(26).foreignKey("trades", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			chargeType: t.enum("charge_type_enum"),
			amount: t.decimal(20, 2),
			currency: t.string(3),
			forexAmount: t.decimal(20, 4).nullable(),
			exchangeRate: t.decimal(20, 8).nullable(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => t.index(["tradeId"]),
	);

	await db.createTable(
		"cash_flows",
		(t) => ({
			id: t.string(26).primaryKey(),
			familyId: t.string(26).foreignKey("teams_app", "id", {
				onUpdate: "RESTRICT",
				onDelete: "CASCADE",
			}),
			accountId: t.string(26).foreignKey("broker_accounts", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			flowDate: t.date(),
			amount: t.decimal(20, 2),
			currency: t.string(3),
			classification: t.enum("cash_flow_classification_enum"),
			transferPairId: t
				.string(26)
				.foreignKey("cash_flows", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			sourceLedgerLineId: t
				.string(26)
				.foreignKey("raw_ledger_lines", "id", {
					onUpdate: "RESTRICT",
					onDelete: "RESTRICT",
				})
				.nullable(),
			classifiedEventId: t.string(26).foreignKey("events", "id", {
				onUpdate: "RESTRICT",
				onDelete: "RESTRICT",
			}),
			inrAmount: t.decimal(20, 2),
			fxRateUsed: t.decimal(20, 8).nullable(),
			createdAt: t.timestamps().createdAt,
			updatedAt: t.timestamps().updatedAt,
		}),
		(t) => [
			t.index(["accountId", "flowDate"]),
			t.index(["familyId", "classification", "flowDate"]),
		],
	);
});
