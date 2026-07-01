import { env } from "@backend/configs/env.config";
import { db } from "@backend/db/db";
import { syncDeltaService } from "@backend/modules/sync/services/sync_delta.sync.service";
import type { FileSelectAll } from "@connected-repo/zod-schemas/file.zod";
import type {
	FilePullBundlesInput,
	FilePullBundlesOutput,
	FilePushCdnUpdateResult,
	FilePushCdnUpdatesInput,
	FilePushCdnUpdatesOutput,
} from "@connected-repo/zod-schemas/files/sync";

/**
 * Origins accepted for `cdnUrl` / `thumbnailCdnUrl` patch values. Anything
 * else is rejected as a URL-defacement attempt (phishing/tracker hosts).
 * Derived once at module load from the same env vars the upload worker uses
 * to construct these URLs, so the allowlist can never drift from reality.
 */
const CDN_ORIGIN_ALLOWLIST: ReadonlySet<string> = (() => {
	const origins = new Set<string>();
	for (const raw of [env.S3_PUBLIC_URL, env.S3_ENDPOINT]) {
		if (!raw) continue;
		try {
			origins.add(new URL(raw).origin);
		} catch {
			// env-parsed URL should always be valid; ignore defensively.
		}
	}
	return origins;
})();

const isAllowedCdnUrl = (url: string): boolean => {
	try {
		return CDN_ORIGIN_ALLOWLIST.has(new URL(url).origin);
	} catch {
		return false;
	}
};

/**
 * Patch `cdnUrl` / `thumbnailCdnUrl` / `isMainFileLost` on file rows the
 * device already created on the server. Called by the FileUploadWorker
 * after its CDN PUT succeeds.
 *
 * Locks every requested row inside one transaction (`forUpdate`), buckets
 * the patches by field, then writes each bucket. Cross-device concurrency:
 * URL fields are only written if the server column is still null — a
 * completed upload from another device cannot be clobbered. `isMainFileLost`
 * is a one-way flip.
 *
 * Tenant safety: even though `FileTable`'s default scope already filters
 * every read by `tenantTeamId` from the request context, we ALSO pass the
 * caller's `activeTeamId` explicitly and require every candidate row to
 * match. This is defence-in-depth against a future accidental
 * `.unscope('default')` regression turning this into a cross-tenant write
 * (attacker patches another team's `cdnUrl` to a phishing/tracker host).
 * URL patches are additionally origin-checked against the server's own
 * CDN allowlist so a compromised device still can't inject a foreign URL.
 */
export async function pushFilesCdnUpdatesService(
	input: FilePushCdnUpdatesInput,
	activeTeamId: string,
): Promise<FilePushCdnUpdatesOutput> {
	if (input.updates.length === 0) return { results: [] };

	const ids = input.updates.map((u) => u.id);

	const results = await db.$transaction(async () => {
		// `forUpdate` serialises concurrent writers so the "only write if
		// null" compare-and-set below is atomic across devices. `teamId`
		// filter is redundant with the default scope but pinned here so any
		// future scope regression can't turn this into a cross-tenant write.
		const existing = await db.files
			.where({ id: { in: ids }, teamId: activeTeamId })
			.forUpdate()
			.selectAll();
		const byId = new Map<string, FileSelectAll>(
			existing.map((r) => [r.id, r as FileSelectAll]),
		);

		// Run per-row UPDATEs concurrently: each patch targets a distinct id
		// and `forUpdate` above already locked every row, so parallel writes
		// are safe and collapse N round-trips into one. `Promise.all` on the
		// mapped array preserves the original `input.updates` order.
		const applyPatch = async (
			patch: FilePushCdnUpdatesInput["updates"][number],
		): Promise<FilePushCdnUpdateResult> => {
			const current = byId.get(patch.id);
			if (!current) {
				// Same error shape for "wrong tenant" and "row missing" so we
				// don't leak whether the id exists in another team.
				return {
					ok: false,
					id: patch.id,
					error: "File row not found — parent bundle likely hasn't landed yet",
				};
			}

			if (patch.cdnUrl && !isAllowedCdnUrl(patch.cdnUrl)) {
				return {
					ok: false,
					id: patch.id,
					error: "cdnUrl host is not in the allowed CDN origins",
				};
			}
			if (
				patch.thumbnailCdnUrl &&
				!isAllowedCdnUrl(patch.thumbnailCdnUrl)
			) {
				return {
					ok: false,
					id: patch.id,
					error: "thumbnailCdnUrl host is not in the allowed CDN origins",
				};
			}

			const cols: Record<string, unknown> = {};
			if (patch.cdnUrl && current.cdnUrl == null) cols.cdnUrl = patch.cdnUrl;
			if (patch.thumbnailCdnUrl && current.thumbnailCdnUrl == null) {
				cols.thumbnailCdnUrl = patch.thumbnailCdnUrl;
			}
			if (patch.isMainFileLost === true && current.isMainFileLost === false) {
				cols.isMainFileLost = true;
			}

			// UPDATE ... RETURNING skips the refetch. If nothing changed
			// (no-op patch), echo the pre-image we already have locked.
			// The `.where({ teamId })` is redundant with the default scope but
			// pinned so `.find()`'s primary-key shortcut can't slip past a
			// future scope regression.
			const row =
				Object.keys(cols).length > 0
					? ((await db.files
							.where({ id: patch.id, teamId: activeTeamId })
							.take()
							.selectAll()
							.update(cols)) as FileSelectAll)
					: current;
			return { ok: true, id: patch.id, row };
		};

		return await Promise.all(input.updates.map(applyPatch));
	});

	return { results };
}

export async function pullFilesService(
	input: FilePullBundlesInput,
): Promise<FilePullBundlesOutput> {
	// Tenant filter applied automatically by FileTable's default scope.
	const baseQuery = db.files;

	const { data, syncMetadata } = await syncDeltaService<FileSelectAll>({
		// biome-ignore lint/suspicious/noExplicitAny: __scopes generic mismatch when narrowing bare table query
		baseQuery: baseQuery as any,
		syncMetadataInput: input.syncMetadata,
		topLevelSyncedAt: input.topLevelSyncedAt,
		syncedTable: "files",
	});

	return { rows: data, syncMetadata };
}
