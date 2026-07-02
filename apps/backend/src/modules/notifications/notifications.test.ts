import { notificationsRouter } from "@backend/modules/notifications/notifications.router";
import { defaultContext } from "@backend/test/setup";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { ORPCError } from "@orpc/contract";

describe("Notifications Endpoints", () => {
	let defaultClient: RouterClient<typeof notificationsRouter>;
	const unauthClient = createRouterClient(notificationsRouter);

	beforeEach(() => {
		defaultClient = createRouterClient(notificationsRouter, {
			context: defaultContext,
		});
	});

	describe("getReminderTimes", () => {
		it("should return empty array by default", async () => {
			const result = await defaultClient.getReminderTimes({});
			expect(result).toEqual(defaultContext!.user.journalReminderTimes);
		});

		it("should reject unauthenticated requests", async () => {
			await expect(unauthClient.getReminderTimes({})).rejects.toThrowError(ORPCError);
		});
	});
});
