import { change } from "../db_script";

// Why a push_devices row was soft-deleted (see uninstalled_at from 0005).
// Nullable — every row starts active, timestamp + reason land together at
// deactivation time, and both clear on re-register.
change(async (db) => {
	await db.changeTable("push_devices", (t) => ({
		deactivationReason: t.add(t.string(30).nullable()),
	}));
});
