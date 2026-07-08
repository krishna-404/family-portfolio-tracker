import { change } from "../db_script";

// Retractability at the raw layer. Rows are never deleted — but a retracted
// batch's raw_trades must not keep occupying the (account_id, broker_trade_id)
// unique key, or re-importing the same file after a retraction would fail on
// the constraint. So each raw row carries `is_live` (stamped false when its
// batch is retracted), and the tradebook dedupe unique index is scoped to
// live rows only. Ledger lines get the same flag for symmetric dedupe.
change(async (db) => {
	await db.changeTable("raw_trades", (t) => ({
		isLive: t.add(t.boolean().default(true)),
	}));
	await db.changeTable("raw_ledger_lines", (t) => ({
		isLive: t.add(t.boolean().default(true)),
	}));

	// Re-scope the tradebook dedupe index so a retracted row frees its key.
	await db.adapter.query(
		`DROP INDEX IF EXISTS "raw_trades_account_id_broker_trade_id_idx"`,
	);
	await db.adapter.query(
		`CREATE UNIQUE INDEX "raw_trades_account_id_broker_trade_id_idx" ` +
			`ON "raw_trades" ("account_id", "broker_trade_id") ` +
			`WHERE "broker_trade_id" IS NOT NULL AND "is_live"`,
	);
	await db.adapter.query(
		`CREATE INDEX "raw_ledger_lines_account_id_is_live_idx" ` +
			`ON "raw_ledger_lines" ("account_id", "is_live")`,
	);
});
