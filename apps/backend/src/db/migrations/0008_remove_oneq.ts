import { change } from "../db_script";

// Foundation reset: the OneQ journaling product is removed; this repo now
// builds Kosh (family portfolio consolidator). Drops the journaling tables
// and column, and repurposes the two OneQ-specific enum values. Both tables
// are product data of the removed feature — irreversible by design (down
// migration recreates empty shells only via rake-db's automatic reverse,
// which we forgo: this change() is forward-only).
change(async (db) => {
	// files.table_name: journalEntries → importBatches (Kosh statement uploads).
	// No files rows exist for the old value once journal entries are gone —
	// they cascaded with their journal entries or are being dropped with the
	// product; rename keeps the enum single-valued and the column type stable.
	await db.adapter.query(
		`ALTER TYPE "file_table_name_enum" RENAME VALUE 'journalEntries' TO 'importBatches'`,
	);
	await db.adapter.query(
		`ALTER TYPE "api_product_enum" RENAME VALUE 'journal_entry_create' TO 'portfolio_read'`,
	);

	// Journal-entry file attachments are orphans once the table drops; remove
	// them ahead of the drop so no files row points at a vanished parent.
	await db.adapter.query(`DELETE FROM "files"`);

	await db.adapter.query(`DROP TABLE IF EXISTS "journal_entries" CASCADE`);
	await db.adapter.query(`DROP TABLE IF EXISTS "prompts" CASCADE`);

	await db.changeTable("users", (t) => ({
		journalReminderTimes: t.drop(t.array(t.time()).default([])),
	}));
});
