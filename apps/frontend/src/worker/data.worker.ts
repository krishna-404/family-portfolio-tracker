import * as Comlink from "comlink";
import { journalEntriesDb } from "../modules/journal-entries/worker/journal-entries.db";
import { promptsDb } from "../modules/prompts/worker/prompts.db";
import { clientDb, subscribe } from "./db/db.manager";
import { filesDb } from "./db/files.db";
import { syncMetadataDb } from "./db/sync_metadata.db";
import { teamMembersDb } from "./db/team_members.db";
import { teamsAppDb } from "./db/teams_app.db";
import type { MediaWorkerAPI } from "./media.worker";
import { syncOrchestrator } from "./sync/sync.orchestrator";
import { setMediaProxyInternal } from "./worker.context";

/**
 * The DataWorker owns Dexie, every table-specific DB adapter, and the
 * SyncOrchestrator. Comlink-exposes them to the main thread. The
 * MediaWorker is bridged in via `setMediaProxy` from the main thread
 * (see `worker.proxy.ts`) so the orchestrator can call CDN operations
 * without the main thread being a middleman on every call.
 */
const dataWorkerApi = {
	db: Comlink.proxy(clientDb),
	filesDb: Comlink.proxy(filesDb),
	journalEntriesDb: Comlink.proxy(journalEntriesDb),
	promptsDb: Comlink.proxy(promptsDb),
	teamsAppDb: Comlink.proxy(teamsAppDb),
	teamMembersDb: Comlink.proxy(teamMembersDb),
	syncMetadataDb: Comlink.proxy(syncMetadataDb),
	sync: Comlink.proxy(syncOrchestrator),
	subscribe: Comlink.proxy(subscribe),

	/**
	 * Bridge the MediaWorker proxy into this worker's context. Called by
	 * the main thread once both workers are ready. The orchestrator
	 * awaits this bridge before running any file-related sync step (see
	 * `worker.context.ts`).
	 */
	setMediaProxy(proxy: Comlink.Remote<MediaWorkerAPI>): void {
		setMediaProxyInternal(proxy);
	},
};

export type DataWorkerAPI = typeof dataWorkerApi;
Comlink.expose(dataWorkerApi);

// Kick a sync as soon as the worker boots. Trigger sources on the main
// thread (visibilitychange / focus / online / post-write kick) will
// call `sync.processQueue()` later as needed.
syncOrchestrator.start();
