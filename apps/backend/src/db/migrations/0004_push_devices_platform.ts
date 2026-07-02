import { change } from "../db_script";

// Device platform + PWA lifecycle timestamps for push_devices.
//
// `platform`: "ios" | "android" | "desktop" — used to skip dispatch to
// iOS non-PWA devices which cannot receive Web Push at all.
//
// `pwa_installed_at`: null = never observed as installed on this device;
// timestamp = first time we saw display-mode standalone / getInstalledRelatedApps.
//
// `pwa_last_launched_at`: updated on each PWA (standalone) launch. Lets us
// detect probable uninstalls heuristically (installed_at set, launched_at
// stale, user active in browser mode). The authoritative "can we push?"
// signal is still FCM error feedback (registration-token-not-registered
// prunes the row).
change(async (db) => {
	await db.changeTable("push_devices", (t) => ({
		platform: t.add(t.string(20).nullable()),
		pwaInstalledAt: t.add(t.timestamp().asNumber().nullable()),
		pwaLastLaunchedAt: t.add(t.timestamp().asNumber().nullable()),
	}));
});
