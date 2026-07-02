import { novu } from "@backend/configs/novu.config";
import { db } from "@backend/db/db";
import { logger } from "@backend/utils/logger.utils";
import { upsertSubscriber } from "@backend/utils/notifications.utils";
import type { DevicePlatform } from "@connected-repo/zod-schemas/enums.zod";

/**
 * Register (or refresh) an FCM device token for a user, then sync the user's
 * FULL set of active tokens to their Novu subscriber's `fcm` credentials.
 *
 * Sync-full-list instead of Novu's `append`/`delete` primitives because the
 * DB is the source of truth: keeping Novu in lockstep with the push_devices
 * table simplifies revocation (one code path) and prevents drift from
 * dropped/retried operations. Extra cost is a single indexed SELECT per
 * register/revoke — cheap compared to the Novu round-trip.
 *
 * Idempotent: registering the same token twice updates `lastSeenAt` instead
 * of failing on the fcm_token unique constraint. If the token was previously
 * owned by a different user (rare — device changed accounts), reassigns.
 */
export const registerFcmDevice = async (params: {
	userId: string;
	fcmToken: string;
	userAgent?: string | null;
	userEmail?: string | null;
	userName?: string | null;
	platform?: DevicePlatform | null;
	pwaInstalled?: boolean;
	pwaStandaloneLaunch?: boolean;
}) => {
	const {
		userId,
		fcmToken,
		userAgent,
		userEmail,
		userName,
		platform,
		pwaInstalled,
		pwaStandaloneLaunch,
	} = params;
	const now = Date.now();

	// Try to touch the currently-active row for this token first. If one
	// exists, the user is either still active or was never soft-deleted —
	// either way, updating in place preserves continuity. If none exists
	// (revoke happened, or brand-new device), INSERT a new row — the prior
	// soft-deleted row stays put so the reactivation lands as its own
	// history entry.
	const updated = await db.pushDevices
		.where({ fcmToken, uninstalledAt: null })
		.update({
			userId,
			userAgent: userAgent ?? null,
			platform: platform ?? null,
			pwaLastLaunchedAt: pwaStandaloneLaunch ? now : null,
			lastSeenAt: now,
		});

	if (updated === 0) {
		await db.pushDevices.create({
			userId,
			fcmToken,
			userAgent: userAgent ?? null,
			platform: platform ?? null,
			pwaInstalledAt: pwaInstalled ? now : null,
			pwaLastLaunchedAt: pwaStandaloneLaunch ? now : null,
			uninstalledAt: null,
			deactivationReason: null,
			lastSeenAt: now,
		});
	} else if (pwaInstalled) {
		// pwaInstalledAt is "first time seen installed on THIS active row";
		// only backfill if the current active row hasn't been stamped yet.
		await db.pushDevices
			.where({ fcmToken, uninstalledAt: null, pwaInstalledAt: null })
			.update({ pwaInstalledAt: now });
	}

	if (!novu) return;

	await upsertSubscriber(userId, {
		email: userEmail ?? null,
		firstName: userName ?? null,
	});

	const activeTokens = (
		await db.pushDevices
			.where({ userId, uninstalledAt: null })
			.select("fcmToken")
	).map((row) => row.fcmToken);

	try {
		await novu.subscribers.credentials.update(
			{
				providerId: "fcm",
				credentials: { deviceTokens: activeTokens },
			},
			userId,
		);
	} catch (error) {
		logger.error(
			{ userId, tokenCount: activeTokens.length, error },
			"Failed to sync FCM credentials to Novu",
		);
		throw error;
	}
};

/**
 * Soft-revoke a device (user opted out on Profile, browser signed out, or
 * pushsubscriptionchange invalidated the old token). Marks `uninstalledAt`
 * so the row survives for lifecycle analytics but doesn't participate in
 * future sync-to-Novu calls. Re-registration clears the timestamp.
 */
export const revokeFcmDevice = async (params: {
	userId: string;
	fcmToken: string;
}) => {
	const { userId, fcmToken } = params;

	await db.pushDevices
		.where({ userId, fcmToken, uninstalledAt: null })
		.update({
			uninstalledAt: Date.now(),
			deactivationReason: "user_revoked",
		});

	if (!novu) return;

	const activeTokens = (
		await db.pushDevices
			.where({ userId, uninstalledAt: null })
			.select("fcmToken")
	).map((row) => row.fcmToken);

	try {
		await novu.subscribers.credentials.update(
			{
				providerId: "fcm",
				credentials: { deviceTokens: activeTokens },
			},
			userId,
		);
	} catch (error) {
		logger.error(
			{ userId, tokenCount: activeTokens.length, error },
			"Failed to sync FCM credentials to Novu after revoke",
		);
		throw error;
	}
};
