import { change } from "../db_script";

// Not strictly "additive-only" per ADR-B01, but this column is empty on
// every row (the feature never shipped), so a direct type change is safe.
// If we ever need to alter a populated array column of the same shape,
// use an additive add + backfill + drop pair instead.
change(async (db) => {
	await db.changeTable("users", (t) => ({
		journalReminderTimes: t.change(
			t.array(t.string()).default([]),
			t.array(t.time()).default([]),
		),
	}));
});
