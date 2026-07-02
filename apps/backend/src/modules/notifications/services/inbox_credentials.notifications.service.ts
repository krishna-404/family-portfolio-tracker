import crypto from "node:crypto";
import { env } from "@backend/configs/env.config";

/**
 * Mint an HMAC-SHA256 hash of the subscriber ID keyed with NOVU_SECRET_KEY.
 * The browser passes { subscriberId, subscriberHash } to `<Inbox />`, which
 * connects to Novu's WS/API using them as bearer auth for that subscriber.
 *
 * Returns null when NOVU_SECRET_KEY is unset (same graceful-degradation
 * posture as the rest of the notification stack — the frontend then hides
 * the bell instead of erroring).
 */
export const buildInboxCredentials = (subscriberId: string) => {
	if (!env.NOVU_SECRET_KEY) return null;

	const subscriberHash = crypto
		.createHmac("sha256", env.NOVU_SECRET_KEY)
		.update(subscriberId)
		.digest("hex");

	return { subscriberId, subscriberHash };
};
