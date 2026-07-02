import { db } from "@backend/db/db";
import { buildInboxCredentials } from "@backend/modules/notifications/services/inbox_credentials.notifications.service";
import {
	registerFcmDevice,
	revokeFcmDevice,
} from "@backend/modules/notifications/services/register_device.notifications.service";
import { rpcProtectedProcedure } from "@backend/procedures/protected.procedure";
import { triggerNotification } from "@backend/utils/notifications.utils";
import { devicePlatformZod } from "@connected-repo/zod-schemas/enums.zod";
import { uniqueTimeArrayZod, zString } from "@connected-repo/zod-schemas/zod_utils";
import { z } from "zod";

const registerDevice = rpcProtectedProcedure
	.input(
		z.object({
			fcmToken: zString.min(1).max(4096),
			userAgent: zString.max(1024).nullish(),
			platform: devicePlatformZod.nullish(),
			pwaInstalled: z.boolean().optional(),
			pwaStandaloneLaunch: z.boolean().optional(),
		}),
	)
	.output(z.object({ ok: z.literal(true) }))
	.handler(async ({ input, context: { user } }) => {
		await registerFcmDevice({
			userId: user.id,
			fcmToken: input.fcmToken,
			userAgent: input.userAgent ?? null,
			userEmail: user.email,
			userName: user.name,
			platform: input.platform ?? null,
			pwaInstalled: input.pwaInstalled,
			pwaStandaloneLaunch: input.pwaStandaloneLaunch,
		});
		return { ok: true as const };
	});

const revokeDevice = rpcProtectedProcedure
	.input(z.object({ fcmToken: zString.min(1).max(4096) }))
	.output(z.object({ ok: z.literal(true) }))
	.handler(async ({ input, context: { user } }) => {
		await revokeFcmDevice({
			userId: user.id,
			fcmToken: input.fcmToken,
		});
		return { ok: true as const };
	});

const inboxCredentials = rpcProtectedProcedure
	.output(
		z.object({
			subscriberId: z.string(),
			subscriberHash: z.string(),
		}).nullable(),
	)
	.handler(async ({ context: { user } }) => {
		return buildInboxCredentials(user.id);
	});

const getReminderTimes = rpcProtectedProcedure
	.output(uniqueTimeArrayZod)
	.handler(async ({ context: { user } }) => {
		const row = await db.users
			.select("journalReminderTimes")
			.findOptional(user.id);
		return row?.journalReminderTimes ?? [];
	});

const setReminderTimes = rpcProtectedProcedure
	.input(z.object({ times: uniqueTimeArrayZod }))
	.output(z.object({ times: uniqueTimeArrayZod }))
	.handler(async ({ input, context: { user } }) => {
		await db.users.where({ id: user.id }).update({
			journalReminderTimes: input.times,
		});
		return { times: input.times };
	});

const testSendPush = rpcProtectedProcedure
	.input(
		z.object({
			title: zString.min(1).max(200).default("Hello from Novu"),
			body: zString.min(1).max(500).default("Push + Inbox pipe is live."),
		}),
	)
	.output(z.object({ ok: z.literal(true) }))
	.handler(async ({ input, context: { user } }) => {
		await triggerNotification({
			workflowId: "test-push",
			subscriberId: user.id,
			payload: { title: input.title, body: input.body },
		});
		return { ok: true as const };
	});

export const notificationsRouter = {
	registerDevice,
	revokeDevice,
	inboxCredentials,
	getReminderTimes,
	setReminderTimes,
	testSendPush,
};
