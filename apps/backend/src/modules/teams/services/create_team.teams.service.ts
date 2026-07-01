import { db } from "@backend/db/db";
import type { TeamAppCreateApiInput } from "@connected-repo/zod-schemas/team_app.zod";

// Server-only options that must NEVER be sourced from a client payload.
// `personalTeamForUserId` in particular controls the soft-delete-partial
// unique slot per user — accepting it from clients would let anyone burn or
// spoof another user's personal-team association.
type CreateTeamServerOptions = {
	personalTeamForUserId?: string | null;
};

export const createTeamService = async (
	userId: string,
	userEmail: string | null,
	userPhoneNumber: string | null,
	input: TeamAppCreateApiInput,
	serverOptions: CreateTeamServerOptions = {},
) => {
	return await db.teamsApp.create({
		name: input.name,
		logoUrl: input.logoUrl ?? null,
		createdByUserId: userId,
		personalTeamForUserId: serverOptions.personalTeamForUserId ?? null,
		members: {
			create: [
				{
					userId,
					email: userEmail,
					phoneNumber: userPhoneNumber,
					role: "Owner",
					joinedAt: Date.now(),
				},
			],
		},
	});
};
