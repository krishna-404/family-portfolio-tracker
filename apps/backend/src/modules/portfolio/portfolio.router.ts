import { db } from "@backend/db/db";
import { rpcProtectedActiveTeamProcedure } from "@backend/procedures/protected.procedure";
import { BROKER_ENUM } from "@connected-repo/zod-schemas/enums.zod";
import { z } from "zod";

// Minimal CRUD to make imports usable. familyId auto-stamps from request
// context (koshFamilyId setOnCreate), and every table's default scope filters
// to the active family — so these handlers never pass or check familyId.

const createPerson = rpcProtectedActiveTeamProcedure
	.input(z.object({ displayName: z.string().min(1).max(120) }))
	.handler(({ input }) =>
		db.persons.create({ displayName: input.displayName }),
	);

const listPersons = rpcProtectedActiveTeamProcedure.handler(() =>
	db.persons.order({ displayName: "ASC" }).select("id", "displayName"),
);

const createAccount = rpcProtectedActiveTeamProcedure
	.input(
		z.object({
			personId: z.string(),
			broker: z.enum(BROKER_ENUM),
			label: z.string().min(1).max(120),
		}),
	)
	.handler(async ({ input }) => {
		await db.persons.find(input.personId); // tenant-scoped: person is in this family
		return db.brokerAccounts.create({
			personId: input.personId,
			broker: input.broker,
			label: input.label,
		});
	});

const listAccounts = rpcProtectedActiveTeamProcedure.handler(() =>
	db.brokerAccounts
		.order({ createdAt: "ASC" })
		.select("id", "personId", "broker", "label", "baseCurrency"),
);

const createGroup = rpcProtectedActiveTeamProcedure
	.input(z.object({ name: z.string().min(1).max(120) }))
	.handler(({ input }) => db.accountGroups.create({ name: input.name }));

const setGroupMembers = rpcProtectedActiveTeamProcedure
	.input(z.object({ groupId: z.string(), accountIds: z.array(z.string()) }))
	.handler(async ({ input }) => {
		await db.accountGroups.find(input.groupId); // tenant-scoped
		// Verify every account belongs to this family before wiring membership.
		for (const accountId of input.accountIds)
			await db.brokerAccounts.find(accountId);
		await db.$transaction(async () => {
			await db.accountGroupMembers.where({ groupId: input.groupId }).delete();
			if (input.accountIds.length > 0) {
				await db.accountGroupMembers.createMany(
					input.accountIds.map((accountId) => ({
						groupId: input.groupId,
						accountId,
					})),
				);
			}
		});
		return { ok: true as const };
	});

const listGroups = rpcProtectedActiveTeamProcedure.handler(async () => {
	const groups = await db.accountGroups
		.order({ name: "ASC" })
		.select("id", "name");
	const members = await db.accountGroupMembers.select("groupId", "accountId");
	return groups.map((g) => ({
		...g,
		accountIds: members
			.filter((m) => m.groupId === g.id)
			.map((m) => m.accountId),
	}));
});

export const portfolioRouter = {
	createPerson,
	listPersons,
	createAccount,
	listAccounts,
	createGroup,
	setGroupMembers,
	listGroups,
};
