/**
 * Cache of the active team id inside the DataWorker. Workers cannot read
 * localStorage; the main thread pushes updates in via
 * `dataProxy.sync.setActiveTeamId(...)`.
 *
 * Every sync round-trip needs this — the backend's `rpcProtectedActiveTeamProcedure`
 * demands `x-team-id` on the request header and rejects otherwise. The
 * orpc client's `headers` hook reads through `getActiveTeamId()` on every
 * request.
 */

let activeTeamId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export const getActiveTeamId = (): string | null => activeTeamId;

export const setActiveTeamId = (id: string | null): void => {
	if (activeTeamId === id) return;
	activeTeamId = id;
	for (const cb of listeners) cb(id);
};

export const onActiveTeamChange = (cb: (id: string | null) => void): (() => void) => {
	listeners.add(cb);
	return () => {
		listeners.delete(cb);
	};
};
