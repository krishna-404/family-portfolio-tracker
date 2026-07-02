import { env } from "@frontend/configs/env.config";
import { type FirebaseApp, initializeApp } from "firebase/app";

/**
 * Main-thread Firebase app singleton. Also initialised inside the service
 * worker (src/sw/sw.ts) — Firebase's `firebase/messaging` main-thread SDK
 * needs the app registered on the window realm to call `getToken()`, and
 * `firebase/messaging/sw` needs it registered on the SW realm to call
 * `onBackgroundMessage`. They're independent instances.
 *
 * Returns null when required config is missing so the push flow can no-op
 * gracefully (same pattern as backend `novu`). `getToken()` needs sender ID
 * + API key at minimum; if either is empty we skip the whole flow.
 */
export const firebaseApp: FirebaseApp | null =
	env.VITE_FIREBASE_API_KEY &&
	env.VITE_FIREBASE_PROJECT_ID &&
	env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
	env.VITE_FIREBASE_APP_ID
		? initializeApp({
				apiKey: env.VITE_FIREBASE_API_KEY,
				authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
				projectId: env.VITE_FIREBASE_PROJECT_ID,
				messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
				appId: env.VITE_FIREBASE_APP_ID,
			})
		: null;
