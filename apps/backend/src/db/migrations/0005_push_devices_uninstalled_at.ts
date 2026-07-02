import { change } from "../db_script";

// Soft-delete signal for push_devices. Set when the FCM token disappears
// from Novu's subscriber credentials (see reconcile_devices) OR when the
// user explicitly revokes push on this device. NULL = active.
//
// Semantically a proxy for "uninstalled" — the actual causes span uninstall,
// clear-site-data, permission revoke, and FCM's own token rotation. Named
// after the primary use case for analytics query readability.
change(async (db) => {
	await db.changeTable("push_devices", (t) => ({
		uninstalledAt: t.add(t.timestamp().asNumber().nullable()),
	}));
	// Partial index — most reads are "active rows for a user"; the index
	// keeps that path index-only while ignoring the growing soft-deleted tail.
	await db.addIndex("push_devices", ["userId"], {
		name: "push_devices_user_active_idx",
		where: "uninstalled_at IS NULL",
	});
});
