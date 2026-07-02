import type * as Comlink from "comlink";
import type { MediaWorkerAPI } from "./media.worker";
import { ProxyCell } from "./utils/ProxyCell";

/**
 * Inside the DataWorker, this holds the *bridged* MediaWorker proxy.
 * The main thread instantiates the MediaWorker, wraps it with Comlink,
 * and passes the proxy in via `dataWorkerApi.setMediaProxy(...)`.
 *
 * The SyncOrchestrator calls `getMediaProxy()` and awaits — if the
 * bridge hasn't been set up yet, the `ProxyCell` pends until it is.
 * This prevents a race where a sync trigger arrives before the main
 * thread has finished wiring up the workers.
 */
const mediaProxyCell = new ProxyCell<Comlink.Remote<MediaWorkerAPI>>();

export const getMediaProxy = (): Promise<Comlink.Remote<MediaWorkerAPI>> => mediaProxyCell.get();

export const setMediaProxyInternal = (proxy: Comlink.Remote<MediaWorkerAPI>): void => {
	mediaProxyCell.set(proxy);
};

export const isMediaProxyReady = (): boolean => !mediaProxyCell.isInitial;
