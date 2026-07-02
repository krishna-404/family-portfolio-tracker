import "@khmyznikov/pwa-install";
import type { PWAInstallElement } from "@khmyznikov/pwa-install";
import { useEffect, useRef, useState } from "react";

export interface PwaInstallState {
	/** True when Chromium's beforeinstallprompt has fired and we can install. */
	isInstallAvailable: boolean;
	/** True when running as an installed PWA (display-mode standalone). */
	isStandalone: boolean;
	/** True on iOS/iPadOS Safari — no beforeinstallprompt, needs manual A2HS. */
	isAppleMobile: boolean;
	/** Fires the native install dialog (Chromium) or shows Apple A2HS steps. */
	install: () => Promise<void>;
	/** The web component element ref — pass to <pwa-install ref={ref}>. */
	ref: React.RefObject<PWAInstallElement | null>;
}

/**
 * React binding around @khmyznikov/pwa-install. The element itself renders
 * hidden — we drive it imperatively through its methods and read its
 * reactive properties, presenting install UX via our own MUI components
 * for palette parity with the rest of the app.
 *
 * Mount <pwa-install ref={ref} style={{ display: 'none' }} /> exactly once
 * per app (typically at the root layout).
 */
export const usePwaInstall = (): PwaInstallState => {
	const ref = useRef<PWAInstallElement | null>(null);
	const [state, setState] = useState({
		isInstallAvailable: false,
		isStandalone: false,
		isAppleMobile: false,
	});

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		const sync = () => {
			setState({
				isInstallAvailable: !!el.isInstallAvailable,
				isStandalone: !!el.isUnderStandaloneMode,
				isAppleMobile: !!el.isAppleMobilePlatform,
			});
		};

		// The element may finish its own detection async — sync now and
		// re-sync when its events fire. Cast to HTMLElement because the
		// library's declared type doesn't extend it (its class definition
		// inherits from LitElement, whose DOM ancestors are erased in the
		// public `.d.ts`).
		sync();
		const target = el as unknown as HTMLElement;
		const events = [
			"pwa-install-available-event",
			"pwa-install-success-event",
			"pwa-user-choice-result-event",
			"pwa-install-how-to-event",
		];
		for (const name of events) {
			target.addEventListener(name, sync);
		}
		return () => {
			for (const name of events) {
				target.removeEventListener(name, sync);
			}
		};
	}, []);

	const install = async () => {
		const el = ref.current;
		if (!el) return;
		el.install();
	};

	return { ...state, install, ref };
};
