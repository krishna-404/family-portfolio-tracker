import { change } from "../db_script";

// Swap the full unique constraint on fcm_token for a partial unique index
// scoped to active rows. Preserves soft-deleted history (reactivation
// cycles land as new rows) while still blocking two concurrent active
// rows for the same token.
change(async (db) => {
	await db.changeTable("push_devices", (t) => ({
		fcmToken: t.change(t.text().unique(), t.text()),
	}));
	await db.addIndex("push_devices", ["fcmToken"], {
		name: "push_devices_fcm_token_active_idx",
		unique: true,
		where: "uninstalled_at IS NULL",
	});
});
