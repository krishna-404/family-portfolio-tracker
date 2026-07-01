import { getDataProxy } from "@frontend/worker/worker.proxy";

/**
 * Main-thread sync trigger installer. Replaces the SSE-driven trigger
 * from the pre-pivot architecture. Fires `sync.processQueue()` on:
 *
 *   1. `visibilitychange` when the tab becomes visible.
 *   2. `focus` on the window.
 *   3. `online` browser event.
 *   4. A 60-second interval (belt-and-braces alongside the interval
 *      inside the DataWorker).
 *
 * The DataWorker's `sync.processQueue()` is idempotent — a trigger
 * arriving while a cycle is in flight sets a rescan bit and the
 * running cycle re-invokes itself on completion, so over-triggering
 * is safe.
 */

let installed = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let removeHandlers: (() => void) | null = null;

async function kick(): Promise<void> {
	try {
		const proxy = await getDataProxy();
		await proxy.sync.processQueue();
	} catch (err) {
		// biome-ignore lint/suspicious/noConsole: worker crash / unreachable state — surface for debugging
		console.warn("[sync-triggers] failed to kick sync", err);
	}
}

export function installSyncTriggers(): void {
	if (installed) return;
	installed = true;

	const onVisibility = () => {
		if (document.visibilityState === "visible") void kick();
	};
	const onFocus = () => {
		void kick();
	};
	const onOnline = () => {
		void kick();
	};

	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("focus", onFocus);
	window.addEventListener("online", onOnline);

	intervalHandle = setInterval(() => {
		void kick();
	}, 60_000);

	removeHandlers = () => {
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("focus", onFocus);
		window.removeEventListener("online", onOnline);
	};

	// Fire once on install to catch up any pending state left behind
	// from a previous session.
	void kick();
}

export function uninstallSyncTriggers(): void {
	if (!installed) return;
	installed = false;
	removeHandlers?.();
	removeHandlers = null;
	if (intervalHandle) {
		clearInterval(intervalHandle);
		intervalHandle = null;
	}
}

/**
 * Push the active team id into the DataWorker so `x-team-id` is set on
 * every subsequent RPC. Call this from `WorkspaceContext` whenever the
 * active workspace changes to a team (pass `null` for personal
 * workspace or when signing out).
 */
export async function pushActiveTeamIdToWorker(teamId: string | null): Promise<void> {
	try {
		const proxy = await getDataProxy();
		await proxy.sync.setActiveTeamId(teamId);
	} catch (err) {
		// biome-ignore lint/suspicious/noConsole: setup failure — surface
		console.warn("[sync-triggers] failed to push active team id", err);
	}
}
