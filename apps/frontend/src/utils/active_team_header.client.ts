/**
 * Isomorphic bridge: returns the current active team id for the ORPC
 * `x-team-id` header regardless of context.
 *
 * - **Main thread:** reads from the workspace localStorage key set by
 *   `WorkspaceContext` (fallback to null if none).
 * - **Worker:** reads from the DataWorker's in-process active-team cache
 *   (populated by the main thread via `dataProxy.sync.setActiveTeamId`).
 *
 * The distinction matters because workers cannot read localStorage.
 */

const STORAGE_KEY_PREFIX = "activeWorkspace_";

/** Runs in the main thread. */
function fromLocalStorage(): string | null {
	try {
		if (typeof localStorage === "undefined") return null;
		// The WorkspaceContext keys entries by userId; we don't know the
		// userId here without extra plumbing. As a best-effort, pick the
		// most recent key. When there's a single logged-in user, this is
		// deterministic.
		let latest: string | null = null;
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw) as { id?: string; type?: string };
				if (parsed?.type === "team" && parsed.id) latest = parsed.id;
			} catch {
				// ignore bad JSON
			}
		}
		return latest;
	} catch {
		return null;
	}
}

/** Runs inside the DataWorker; the main thread pushes changes in. */
async function fromWorkerCache(): Promise<string | null> {
	// Dynamic import to avoid pulling the module into the main-thread
	// bundle. The main thread never calls this branch.
	const mod = await import("../worker/sync/active_team");
	return mod.getActiveTeamId();
}

/**
 * Synchronous read used by the RPC link's headers hook. In workers,
 * falls back to a module-scoped cache populated on `setActiveTeamId`.
 */
let workerCache: string | null = null;
void (async () => {
	if (typeof window === "undefined" && typeof self !== "undefined") {
		try {
			workerCache = await fromWorkerCache();
			const mod = await import("../worker/sync/active_team");
			mod.onActiveTeamChange((id) => {
				workerCache = id;
			});
		} catch {
			workerCache = null;
		}
	}
})();

export const getActiveTeamIdForRequests = (): string | null => {
	if (typeof window !== "undefined") return fromLocalStorage();
	return workerCache;
};
