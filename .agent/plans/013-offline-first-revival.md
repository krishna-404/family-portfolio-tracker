# Plan 013 — Offline-First Revival (SSE-free, µs-timestamp)

## Goal

Bring back offline-first behavior in `connected-repo` after the OneQ pivot (`9fae890`), using the pre-pivot **worker + Dexie + Comlink** shell but with a **new wire protocol**: no SSE, no streaming, no in-memory publisher — plain non-streaming RPCs modelled on `teziapp/new-tezi-app`.

Semantics are **online-first with offline as fallback** (mirrors tezi's `OnlineFirstAdapter`), not the pre-pivot Mutation Barrier where creates always queued.

## What we keep from pre-pivot connected-repo

- Two Web Workers (DataWorker + MediaWorker) bridged by `ProxyCell` via Comlink.
- Dexie local DB + hand-rolled `BroadcastChannel("db-updates")` reactivity (`useLocalDb` / `useLocalDbItem` / `useLocalDbValue`).
- 3-stage file pipeline (original + thumbnail uploaded in parallel, then metadata).
- OPFS blob staging with SHA-256 checksums + `/opfs-media/*` Service Worker fetch handler for local preview.
- CDN-first recovery for lost blobs (`checkFileExistsInCdn`).
- Orchestrator `isProcessing` + `needsRescan` lock.

## What we adopt from teziapp

- Postgres `updatedAt` transported as **µs-string** (already `nowSQL: clock_timestamp() AT TIME ZONE 'UTC'` in `apps/backend/src/db/base_table.ts`; today it's `.asNumber()` — switch to `.parse(parseMicrosecondsToEpochStr)`).
- **Two-cursor pull protocol** — `toCursor{Id,UpdatedAt}` (catch-up, strictly `>`) + `fromCursor{Id,UpdatedAt}` (history, strictly `<`) walked with one `OR` predicate.
- **`topLevelSyncedAt` snapshot ceiling** — minted by wave-1 `teams.pullDelta` (`Date.now()`); every downstream table filters `updatedAt < topLevelSyncedAt`.
- **ULID `id` tie-breaker** at identical `updatedAt` + composite `(teamId, updatedAt, id)` index on every synced table.
- **Push endpoints**: `pushBundles` for anything with relations (all connected-repo mutable tables — files always ride with the parent), `pushCdnUpdates` for the narrow post-upload CDN URL patch.
- Server always re-stamps `updatedAt` with `clock_timestamp()` — client-supplied values are dropped.
- Insert-only design for sync — edits and hard-deletes stay on the ordinary online routes.
- **Pending state inferred from `createdAt IS NULL`** — no `_pendingAction` column. Server never inserts a row with `createdAt = null`, so the presence of null = local-only.
- **Per-layer file state machine on the `files` table itself** — `mainUploadState`, `mainUploadAttempts`, `mainLastError`, `mainLastAttemptAt`, and the same for `thumbnail*`. No separate `file_upload_queue` table.

## Divergence from tezi — deliberate

Tezi's Pattern B `pushCreates` (companies, leads) omits `files` from the sync payload — file rows only land on the server via the online `create` path with relations. This creates a latent gap: if the online create fails and the client falls back to the sync queue, file rows are orphaned locally. Tezi documents this as *"the row will appear once the parent's bundle/pushCreates lands"* (`sync.files.service.ts:22-25`) but Pattern B never carries the files, so the assertion is only true for Pattern A.

**We reject this shape.** In connected-repo:

- Every write of a parent-with-relations sends **the same bundle** whether the code path is online (`create` handler) or offline-queued (`pushBundles` handler). The two handlers accept structurally identical inputs. Files metadata always rides with the bundle.
- `pushCdnUpdates` remains the only channel for `cdnUrl` / `thumbnailCdnUrl` / `isMainFileLost` — captured after the FileUploadWorker completes. It never carries metadata (matches tezi's rationale in `files/sync.ts:47-49`).

## What we drop from pre-pivot

- SSE `heartbeatSync` procedure (`sync.router.ts` was streaming).
- `sync.service.ts` EventPublisher + `syncPayloadZod` discriminated union.
- `sync.visibility.service.ts` visibility filters (live push had them; delta pulls don't need them).
- `SSE_MESSAGES_CHANNEL` BroadcastChannel and orchestrator's subscription to it.
- `sse/*` under `apps/frontend/src/sw/` (SSEManager, OfflineBanner, StatusBadge, useConnectivity, SSE_ARCHITECTURE.md).
- `proxy.sw.ts` (existed only to bridge SSEManager).
- The Mutation Barrier rule ("edits require online"). Replaced by online-first-with-fallback.

## Semantics: online-first with offline fallback

Every write flows through an `OnlineFirstAdapter` shape. The **payload is identical** whether the write ends up online (single request to `create`) or falls back to offline (deferred `pushBundles` batch) — the entire bundle including all relations (files, child rows) travels together:

```ts
async createBundle<T extends { id: string }>(opts: {
  bundle: T & { createdAt: null };            // parent + relations (files, children)
  localWrite: (b: T) => Promise<void>;        // Dexie writes parent + relations pending
  online: (b: T) => Promise<T>;               // e.g. orpcFetch.journalEntries.create(bundle)
  onlineOverwrite: (server: T) => Promise<void>;
  table: AppDbTable;
  timeoutMs?: number;
}): Promise<WriteResult> {
  await opts.localWrite(opts.bundle);          // local write first — UI shows immediately
  notifySubscribers(opts.table);               // BroadcastChannel fanout
  try {
    const server = await opts.online(opts.bundle);      // full bundle to `create`
    await opts.onlineOverwrite(server);                  // overwrite pending rows with server rows
    notifySubscribers(opts.table);
    return { status: "savedOnline" };
  } catch (err) {
    // 5xx / timeout / offline: leave pending rows alone, kick sync
    dataProxy.sync.processQueue();
    return { status: "savedOffline", error: err };
  }
}
```

Later, the sync orchestrator drains pending bundles by calling `pushBundles` — the **same bundle shape** goes over the wire, just batched across multiple pending parents. No branching between "online write" and "offline write" payload shapes anywhere in the stack.

For files specifically:
- Pick + stage → local file row inserted with `createdAt: null`, `mainUploadState: 'pending'`, blob → OPFS.
- Bundle (parent + `files: [...]`) sent to `create` immediately if online, or queued for `pushBundles` if offline.
- Server accepts the file metadata rows atomically; `cdnUrl` / `thumbnailCdnUrl` on those rows start `null`.
- FileUploadWorker uploads the blob to CDN independently; on success, patches the server via `pushCdnUpdates`.

**Reads** union confirmed rows with pending rows (both live in the same Dexie table). A `<SyncCardWrapper isPending={row.createdAt == null} error={row.syncError}>` badge distinguishes them in the UI.

**Edits / deletes** on an already-synced row (`createdAt != null`) go straight to the online route and the response overwrites the local cache — no offline queueing for these. If the online route fails and the user is offline, surface the error to the UI. Reason: without CRDT / LWW machinery we cannot merge edits safely; matches tezi.

**Pending rows** get retried by the orchestrator on every sync cycle. Trigger sources:

1. `visibilitychange` (main thread) → `dataProxy.sync.processQueue()`
2. `focus` (main thread) → same
3. `online` browser event (main thread + worker) → same
4. Post-write kick when `savedOffline` returns
5. Slow interval fallback (60s) in the DataWorker
6. Successful RPC response → mark online + kick (mirrors tezi's `markOnlineFromResponse`)

## Backend changes

### Schema — µs-string encoding on `updatedAt`

**File**: `apps/backend/src/db/base_table.ts`

- Add `parseMicrosecondsToEpochStr(input: unknown): string` (verbatim from tezi `base_table.ts:25-46`).
- In `timestamps()` and `idAndAuditTimestamps()`, replace `updatedAt: t.timestamps().updatedAt.asNumber()` with `updatedAt: t.timestamps().updatedAt.parse(parseMicrosecondsToEpochStr)`.
- Keep `createdAt` as `.asNumber()` — the client only uses it as a "pending vs confirmed" flag, doesn't sort by it.
- **Do not change** the column DDL — Postgres `timestamp` already holds µs precision; this is only wire-format parsing.

**Package**: `packages/zod-schemas/src/zod_utils.ts`

- Add `zMicroSecondTimeString = z.coerce.string().regex(/^\d+$/)` next to `zTimeEpoch`.

**Package**: `packages/zod-schemas/src/sync.zod.ts` (new — was deleted in pivot)

- Restore with tezi shape:

```ts
export const syncMetadataZod = (tableName: string) => z.object({
  teamId: z.ulid(),
  syncedTable: z.literal(tableName),
  fromCursorId: z.string().nullable(),
  fromCursorUpdatedAt: zMicroSecondTimeString.nullable(),
  toCursorId: z.string().nullable(),
  toCursorUpdatedAt: zMicroSecondTimeString.nullable(),
  syncedAt: zTimeEpoch.nullable(),
  totalRecords: z.number(),
});

export const syncDeltaInputZod = (tableName: string) => z.object({
  syncMetadata: syncMetadataZod(tableName).nullable(),
  topLevelSyncedAt: zTimeEpoch,   // client passes what wave-1 minted; server enforces the ceiling
});
```

### Composite indexes

Add `t.index(["teamId", "updatedAt", "id"])` to every synced-table definition (files, journal_entries, prompts, team_members, teams_app). Migration file: `apps/backend/src/db/migrations/000X_add_sync_indexes.ts`.

### New sync module

**Directory**: `apps/backend/src/modules/sync/` (was deleted in pivot).

- `sync.service.ts` (rewritten, not the old EventPublisher) — one generic `syncDeltaService` port of tezi's `sync_delta.sync.service.ts`. Handles `toCursor` catch-up, `fromCursor` pagination, the `topLevelSyncedAt < ceiling` filter, `includeDeleted()` for tombstones, `syncedAt = Date.now()` stamp, and `totalRecords` count.
- `sync.zod.ts` — moved into the module or kept in the shared package.

### Per-table pull + push routes

| Table | Push route | Pull route | Notes |
|---|---|---|---|
| `teamsApp` | — (server-authored) | `pullDelta` | Wave-1 anchor, mints `topLevelSyncedAt` |
| `teamMembers` | — (server-authored via team invites) | `pullDelta` | |
| `prompts` | — (server-authored) | `pullDelta` | |
| `journalEntries` | `pushBundles` (carries `files`) | `pullDelta` | The mutable domain table |
| `files` | (rides in `journalEntries.pushBundles`) + `pushCdnUpdates` | `pullDelta` | Metadata always bundled with parent; CDN URLs patched post-upload |

**Bundle shape** (used by BOTH the online `journalEntries.create` route AND the offline `journalEntries.pushBundles` route — same zod input, different handlers):

```ts
export const journalEntryBundleZod = z.object({
  ...journalEntryCreateInputZod.shape,       // parent fields, sans server-managed
  files: z.array(fileCreateInputZod).nullish(),
});

export const journalEntryPushBundlesInputZod = z.object({
  bundles: z.array(journalEntryBundleZod),
});

export const journalEntryPushBundleResultZod = z.object({
  ok: z.boolean(),
  id: z.ulid(),
  bundle: z.object({
    ...journalEntrySelectAllZod.shape,
    files: z.array(fileSelectAllZod),
  }).nullish(),
  error: z.string().nullish(),
});
```

### Push handler — bulk-first, sequential-fallback (nested create shape)

The push service tries **one bulk nested-create** first, then falls back to per-row nested creates only if the bulk path throws. No explicit `db.$transaction` wrapping — the ORM handles parent + child atomicity as part of the nested create itself (mirrors the online path at `companies.router.ts:157-162` in tezi and connected-repo's own online `create` handlers).

```ts
// apps/backend/src/modules/journal-entries/services/push_bundles.journal_entries.service.ts

export async function pushJournalEntryBundlesService(
  input: JournalEntryPushBundlesInput,
): Promise<JournalEntryPushBundlesOutput> {
  if (input.bundles.length === 0) return { results: [] };

  // ─── Fast path: bulk nested createMany ───
  try {
    const bulkResults = await tryBulkInsert(input.bundles);
    return { results: bulkResults };
  } catch (bulkErr) {
    // Bulk threw — a NOT NULL / FK / check-constraint failure on at least one
    // row rolled the whole batch back. Fall through to per-row so we can
    // isolate the bad rows as {ok:false,id,error} and still land the good ones.
    log.warn({ err: bulkErr }, "pushJournalEntryBundles bulk path failed; falling back to sequential");
  }

  // ─── Slow path: per-row nested create ───
  const results: JournalEntryPushBundlesOutput["results"] = [];
  for (const b of input.bundles) {
    try {
      const bundle = await insertOneBundle(b);
      results.push({ ok: true, id: b.id, bundle });
    } catch (err) {
      results.push({ ok: false, id: b.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results };
}
```

**`tryBulkInsert` — bulk nested `createMany`.** One ORM call that inserts every parent and its nested files. Because `onConflictDoNothing("id")` silently skips rows that already exist, we then fetch canonical rows by id so the client always gets the server-owned `updatedAt` back — including for rows that were skipped due to a retry.

```ts
async function tryBulkInsert(
  bundles: JournalEntryBundle[],
): Promise<Array<JournalEntryPushBundleResult>> {
  const parentIds = bundles.map((b) => b.id);

  await db.journalEntries
    .createMany(
      bundles.map(({ files, ...parent }) => ({
        ...parent,
        ...(files?.length
          ? {
              files: {
                create: files.map((f) => ({ ...f, tableName: "journal_entries" as const })),
              },
            }
          : {}),
      })),
    )
    .onConflictDoNothing("id");

  // Canonical fetch — covers both freshly-inserted rows AND rows skipped by
  // onConflictDoNothing (e.g. re-push after network retry). One query each side.
  const canonicalParents = await db.journalEntries
    .where({ id: { in: parentIds } })
    .selectAll();
  const canonicalFiles = await db.files
    .where({ tableName: "journal_entries" as const, tableId: { in: parentIds } })
    .selectAll();

  const filesByParent = new Map<string, FileSelectAll[]>();
  for (const f of canonicalFiles) {
    const arr = filesByParent.get(f.tableId) ?? [];
    arr.push(f);
    filesByParent.set(f.tableId, arr);
  }
  const parentById = new Map(canonicalParents.map((p) => [p.id, p]));

  return bundles.map((b) => {
    const parent = parentById.get(b.id);
    if (!parent) {
      // Would only happen if a concurrent request wiped the row between insert
      // and fetch. Report so the client retries.
      return { ok: false as const, id: b.id, error: "Row missing after bulk insert" };
    }
    return {
      ok: true as const,
      id: b.id,
      bundle: { ...parent, files: filesByParent.get(b.id) ?? [] },
    };
  });
}
```

**`insertOneBundle` — per-row nested create.** Same shape, one bundle at a time. No transaction wrapper — the single nested create is atomic on its own. One bad row throws in isolation without taking the rest of the batch down.

```ts
async function insertOneBundle(b: JournalEntryBundle): Promise<JournalEntryPushBundleWithFiles> {
  const { files, ...parent } = b;

  await db.journalEntries
    .create({
      ...parent,
      ...(files?.length
        ? {
            files: {
              create: files.map((f) => ({ ...f, tableName: "journal_entries" as const })),
            },
          }
        : {}),
    })
    .onConflictDoNothing("id");

  const canonicalParent = await db.journalEntries.find(b.id);
  const canonicalFiles = await db.files
    .where({ tableName: "journal_entries" as const, tableId: b.id })
    .selectAll()
    .order({ sortIndex: "ASC" });
  return { ...canonicalParent, files: canonicalFiles };
}
```

**Retry semantics with nested `onConflictDoNothing`:** if the parent id conflicts, the nested files inserts are also skipped (they only run as part of the parent's insert). So on retry: parent skipped, children never re-attempted. That's fine because the previous successful insert already wrote both. If the previous attempt somehow inserted the parent but failed mid-file-batch (unlikely without a torn commit — nested create is one statement), the retry would leave the missing file rows absent; the canonical fetch would return the parent with fewer files than the client thinks it sent. Verify during build that orchid-orm's nested `create` inside `createMany` is emitted as a single INSERT-with-CTE (or equivalent) rather than N separate INSERTs — if it's the latter, we need `$transaction` back around the fast path. Verification task added below.

**Idempotency rules:**
- All ids (parent AND file) are client-generated ULIDs. Re-push on network retry hits `onConflictDoNothing("id")` and returns the canonical existing row. The client's echo-reconciliation loop is safe against duplicates.
- The canonical-row fetch inside the transaction guarantees the client always gets the **current server-owned `updatedAt`** back, even for rows that were already present.
- If bulk succeeds but the caller times out on the response, the retry re-runs bulk, hits every id as a conflict, and returns the same canonical rows — safe.

**Standalone attach-to-existing-entry** (adding a file to a journal entry created in a prior session): this is a *synced-row edit*. Per our online-first-with-fallback rule, edits on synced rows require online. If the user is online, we call the existing `orpcFetch.journalEntries.update` (or a dedicated `files.attach` route) which writes the file row alongside. If offline, we surface the error — no offline attach queue.

### Auth + tenancy

Existing `rpcProtectedActiveTeamProcedure` and `AsyncLocalStorage` request context already stamp `teamId` on inserts — no changes. `x-team-id` header is already required.

## Frontend changes

### Restore the worker shell

**Directory**: `apps/frontend/src/worker/` — restore from `9fae890~1`, minus SSE coupling:

- `data.worker.ts` — restore, but **delete** the `syncOrchestrator.start()` call's dependency on SSE (see orchestrator change below).
- `worker.context.ts`, `worker.proxy.ts`, `utils/ProxyCell.ts` — restore verbatim.
- `utils/opfs.manager.ts` — restore verbatim.

### Restore Dexie layer with tezi-shaped rows

**Directory**: `apps/frontend/src/worker/db/`

- `db.manager.ts` — restore. Schema changes:
  - Drop `_pendingAction`, `_lastSyncAttemptAt` from every index.
  - Add `syncError` to every synced table (mirrors tezi).
  - Add `mainUploadState`, `mainUploadAttempts`, `mainLastError`, `mainLastAttemptAt`, `thumbnailUploadState`, `thumbnailUploadAttempts`, `thumbnailLastError`, `thumbnailLastAttemptAt` to `files` schema.
  - Bump Dexie version to 3.
- `schema.db.types.ts` — restore `StoredFile` but with the new per-layer state fields; drop `_pendingAction` / `_lastSyncAttemptAt` / `_syncError` (replaced by `syncError` non-underscore).
- `files.db.ts`, `team_members.db.ts`, `teams_app.db.ts` — restore.
- `hooks/useLocalDb.ts`, `useLocalDbItem.ts`, `useLocalDbValue.ts` — restore verbatim (they subscribe to `BroadcastChannel("db-updates")`).

### Restore module-level DB adapters

- `apps/frontend/src/modules/journal-entries/worker/journal-entries.db.ts` — restore, but replace the online-only edit-check with the online-first-adapter pattern.
- `apps/frontend/src/modules/prompts/worker/prompts.db.ts` — restore (pull-only, no adapter).

### `OnlineFirstAdapter` shape

**New file**: `apps/frontend/src/worker/db/online-first.adapter.ts`

Generic wrapper used by every module DB adapter:

```ts
export async function createOnlineFirst<T extends { id: string }>(opts: {
  local: T & { createdAt: null };
  online: () => Promise<T>;
  table: AppDbTable;
  put: (row: T) => Promise<void>;
  timeoutMs?: number;
}): Promise<WriteResult> { … }
```

### Sync orchestrator (rewrite)

**File**: `apps/frontend/src/worker/sync/sync.orchestrator.ts`

- **Remove** `sseChannel = new BroadcastChannel(SSE_MESSAGES_CHANNEL)` block from the constructor.
- **Keep** `isProcessing` + `needsRescan` lock + `subscribe(callback)` DB-write trigger + `online` event trigger.
- **Add** a new `pullDelta(tableName)` method that migrates the delta-application logic from the deleted `sse.manager.sw.ts` `tableHandlers` map. Reads/writes `syncMetadata` cursors in Dexie.
- Wave order preserved: `teamsApp → teamMembers → prompts → journalEntries → files`.
- Wave-1 (`teamsApp.pullDelta`) captures `topLevelSyncedAt` from the server response and threads it through subsequent wave calls in the same cycle.
- **Two pipelines** run in parallel per cycle: push (walks tables that have pending rows) and pull (walks all tables). Match tezi's `Future.wait([push, pull])`.
- Retry: cap concurrent retries per row; exponential backoff cleared on the row via `mainUploadAttempts` counter (for files) or a per-row backoff map keyed by `syncKey = "${table}:${id}"` (for non-file rows, mirrors old code).

### Files pipeline

**File**: `apps/frontend/src/worker/sync/file-upload.worker.ts` (new — factored out of the old orchestrator's inline file logic)

- Ports tezi's `file_upload_worker.dart` state machine to TS.
- `mainUploadState` transitions: `pending → uploading → uploaded_to_cdn → uploaded` (+ `failed` / `lost` / `abandoned`).
- Concurrency limit: `pLimit(3)` (matches tezi + old `mediaUploadService`).
- Retry: max 5 attempts, backoff `[1, 2, 4, 8, 16]` seconds.
- Stuck-uploading cutoff: 5 minutes (recovery re-picks orphans).
- On `uploaded_to_cdn`, calls `dataProxy.sync.processQueue()` with `force: true` to push the fresh `cdnUrl` via `pushCdnUpdates` without waiting for the 60s tick.

### Service Worker

**File**: `apps/frontend/src/sw/sw.ts`

- **Keep** the `/opfs-media/*` fetch handler intact (it serves cached blobs for `<img src>`).
- **Remove** the `new SSEManager()` + Comlink handshake.
- Delete `apps/frontend/src/sw/proxy.sw.ts` and the entire `apps/frontend/src/sw/sse/` directory.

### Connectivity / triggers

**New file**: `apps/frontend/src/utils/sync-triggers.ts` (main thread)

- On mount:
  - `document.addEventListener("visibilitychange", ...)` when `document.visibilityState === "visible"` → `dataProxy.sync.processQueue()`.
  - `window.addEventListener("focus", ...)` → same.
  - `window.addEventListener("online", ...)` → same.
- **Salvage** `checkActualInternet` and `checkServerHealth` from the deleted `useConnectivity.sse.sw.ts` into a plain `apps/frontend/src/utils/connectivity.ts` — used by `OfflineBanner` / `StatusBadge` if we rebuild those.
- Rebuild `OfflineBanner` / `StatusBadge` without SSE state — plain online/health signal.

### `configs/channels.config.ts`

Remove `SSE_MESSAGES_CHANNEL` and `SseMessage` (they were deleted in the pivot; make sure the file doesn't get re-added with them).

## Migration steps (execution order)

1. **Backend µs-string parsing** — edit `base_table.ts`, add `parseMicrosecondsToEpochStr`, switch `updatedAt` on all synced tables to `.parse(...)`. Add migration for composite `(teamId, updatedAt, id)` indexes.
2. **Backend sync module** — recreate `apps/backend/src/modules/sync/` with the generic `syncDeltaService` (tezi port). Add `sync.zod.ts`.
3. **Backend per-table sync routes** — `teams.pullDelta` (wave-1 anchor), then `teamMembers.pullDelta`, `prompts.pullDelta`, `journalEntries.pushCreates` + `pullDelta`, `files.pushCdnUpdates` + `pullDelta`.
4. **Frontend worker shell** — restore `worker/db/`, `worker/utils/`, `worker/cdn/` untouched (already exist), plus restore `data.worker.ts` and the ProxyCell bridge.
5. **Frontend module DB adapters** — restore `journal-entries.db.ts`, `prompts.db.ts` with `OnlineFirstAdapter`.
6. **Frontend sync orchestrator** — write from scratch: two-pipeline, wave-ordered, no SSE trigger, delta-pull method with tezi cursor protocol.
7. **Frontend file upload worker** — factor out from orchestrator; per-layer state machine.
8. **Frontend triggers** — mount main-thread `visibilitychange` / `focus` / `online` listeners; wire post-write kick from `OnlineFirstAdapter`.
9. **Frontend SW cleanup** — strip SSE bits from `sw.ts`; keep `/opfs-media/*` handler.
10. **UI wrappers** — `<SyncCardWrapper>` for pending vs confirmed rows; rebuild offline banner without SSE.

## Non-goals

- **CRDT / LWW conflict resolution.** Edits/deletes on synced rows require online (no offline queueing).
- **Background sync via SW / WorkManager.** Foreground only, matches tezi (deliberate simplification).
- **Cross-tab sync.** `BroadcastChannel` fanout is best-effort; if two tabs mutate the same pending row, last write wins locally.
- **Web-worker → main-thread structured clone optimisations.** Comlink RPC per call is fine at our data volumes.

## Related rules to update / recreate

- `.agent/rules/offline-sync-integrity.md` (was deleted) — recreate with the new online-first semantics + no-CRDT non-goal.
- `.agent/rules/worker-isolation.md` (was deleted) — recreate; workers still exist, just no SSE.
- `.agent/rules/dexie-migrations.md` (was deleted) — recreate; schema will bump to v3.

## Resolved decisions

- **Push acknowledgement shape** — `{ok, id, bundle: {...parent, files: [...]}}` per bundle. Client overwrites the pending Dexie rows (parent + relations) atomically from the returned server rows.
- **Same bundle shape online and offline** — both the online `journalEntries.create` and the offline `journalEntries.pushBundles` accept structurally identical inputs. No branching on payload shape between the two paths. Divergence from tezi (which drops `files` from the sync payload) is deliberate — see "Divergence from tezi" section.
- **Bulk-first, sequential-fallback push handler with nested creates** — one `createMany` (or per-row `create` on fallback) with `files: { create: [...] }` nested inline. No `$transaction` wrapper: the ORM emits the nested create as a single atomic statement (verify during build). Followed by a canonical-row fetch (`WHERE id IN`) to fill in rows skipped by `onConflictDoNothing("id")` so the client always gets the server-owned `updatedAt` back. Falls back to per-row nested `create` only when the bulk path throws.
- **CDN URL patching stays disjoint** — `files.pushCdnUpdates` remains the narrow post-upload patch endpoint (`cdnUrl`, `thumbnailCdnUrl`, `isMainFileLost` only). It does not accept metadata and does not create rows.

## Open questions

- **`clientCreatedAt` / `clientEditedAt`** — already in `idAndAuditTimestamps`. Confirm whether we stamp them client-side (tezi does — device-local UI ordering) or leave null.
- **Total-records progress UI** — tezi's `SyncMetadataDao.totalRecords` drives a progress bar. Do we surface it in the initial-sync experience?
- **Attach-to-existing-entry semantics** — do we ever need to attach a file to a journal entry created in a prior session? If yes, this is a synced-row edit and requires online (per the online-first rule). If no, delete the branch that considers it.
- **Nested-create atomicity in orchid-orm** — verify during build that `db.parent.createMany([{...p, children: {create: [...]}}]).onConflictDoNothing("id")` emits one atomic statement (INSERT-with-CTE or equivalent) rather than N separate INSERTs. If it emits separate statements, wrap the fast path in `db.$transaction` after all — the nested-create ergonomics we prefer become a leaky abstraction otherwise.
