import { rpcProtectedActiveTeamProcedure } from "@backend/procedures/protected.procedure";
import { z } from "zod";
import {
	applyImport,
	listBatches,
	prepareImport,
	retractBatch,
} from "./services/zerodha_import.service";

const importInputZod = z.object({
	accountId: z.string(),
	kind: z.enum(["tradebook", "ledger"]),
	fileName: z.string().min(1).max(255),
	content: z.string().min(1).max(20_000_000),
});

const preview = rpcProtectedActiveTeamProcedure
	.input(importInputZod)
	.handler(({ input }) => prepareImport(input));

const apply = rpcProtectedActiveTeamProcedure
	.input(importInputZod)
	.handler(({ input }) => applyImport(input));

const retract = rpcProtectedActiveTeamProcedure
	.input(z.object({ batchId: z.string(), reason: z.string().min(1).max(500) }))
	.handler(async ({ input }) => {
		await retractBatch(input);
		return { ok: true as const };
	});

const list = rpcProtectedActiveTeamProcedure
	.input(z.object({ accountId: z.string() }))
	.handler(({ input }) => listBatches(input.accountId));

export const importsRouter = { preview, apply, retract, list };
