import { z } from "zod";
import { promptSelectAllZod } from "../prompt.zod.js";
import { syncDeltaInputZod, syncMetadataZod } from "../sync.zod.js";

export const promptsPullDeltaInputZod = syncDeltaInputZod;
export type PromptsPullDeltaInput = z.infer<typeof promptsPullDeltaInputZod>;

export const promptsPullDeltaOutputZod = z.object({
	rows: z.array(promptSelectAllZod),
	syncMetadata: syncMetadataZod,
});
export type PromptsPullDeltaOutput = z.infer<typeof promptsPullDeltaOutputZod>;
