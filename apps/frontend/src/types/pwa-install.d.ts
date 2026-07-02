import type { PWAInstallElement } from "@khmyznikov/pwa-install";
import type React from "react";

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			"pwa-install": React.DetailedHTMLProps<
				React.HTMLAttributes<PWAInstallElement> & {
					"manifest-url"?: string;
					icon?: string;
					name?: string;
					description?: string;
					"install-description"?: string;
					"disable-chrome"?: string;
					"disable-close"?: string;
					"manual-apple"?: string;
					"manual-chrome"?: string;
					"use-local-storage"?: string;
					ref?: React.Ref<PWAInstallElement>;
				},
				PWAInstallElement
			>;
		}
	}
}
