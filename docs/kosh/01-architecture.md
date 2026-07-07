# Kosh — System Architecture

## 1. Stack decision: TypeScript core, one Python tool wrapped

**Decision (2026-07-07):** Kosh's core stays all-TypeScript on the existing monorepo (oRPC + Orchid ORM + Postgres backend, React 19 + Vite frontend). There is **no long-running Python service**. Python appears in exactly one place:

- **casparser** (CAMS/KFintech CAS PDF parsing, MIT) is consumed as a **CLI subprocess**: the ingestion worker shells out to `casparser -o json <file>` and treats the JSON as just another raw import payload. It's stateless, versioned in the Docker image (`pip install casparser==<pinned>`), and its output passes through the same validation gate as every other import. If it ever becomes a problem, it's one subprocess call to replace.
- **pyxirr** is **not run** — its solver algorithm is **ported to TypeScript** (`packages/finance-math`). It's Unlicense (public domain), so the port is friction-free; porting keeps the metrics engine in-process, synchronously testable, and free of IPC for the hottest code path.
- Market-data fetchers (bhavcopy, AMFI NAVAll, niftyindices TRI, IBJA gold, FX) are **native TypeScript** — they're plain HTTP + CSV/JSON parsing; no library dependency worth a second runtime.

Rationale: the only Python component that earns its keep is casparser (339 commits of PDF edge cases we must not re-derive). Everything else is either simple enough to write in TS or portable. One runtime for all product logic; one pinned CLI tool for one file format.

## 2. Monorepo mapping

```
apps/
  backend/src/modules/
    auth/                  # KEEP (Better Auth) — unchanged
    users/                 # KEEP
    teams/                 # KEEP, pending access-model grilling (family = team candidate)
    files/ cdn/            # KEEP — statement uploads ride the existing file infra
    notifications/         # KEEP (Novu) — action-needed prompts, dividend confirmations
    portfolio/             # NEW — broker accounts, account groups, persons
    imports/               # NEW — import batches, parsers, validation gate, quarantine
    instruments/           # NEW — instrument master, aliases, identity links
    corporate-actions/     # NEW — event log, application state, prompt queue
    market-data/           # NEW — price bars, index/gold series, FX rates, ingestion jobs
    ledger/                # NEW — trades, cash flows, dividends, fee schedules (the ground truth)
    metrics/               # NEW — valuation snapshots, metric computation, shadow portfolios, trails
    journal-entries/ prompts/ subscriptions/   # REMOVE (OneQ) — foundation-reset ticket
  frontend/src/modules/
    dashboard/             # NEW — hero view: selector, date range, tiles, benchmark chart
    imports/               # NEW — upload, dry-run preview, quarantine review
    accounts/              # NEW — accounts, groups, persons, fee schedules
    actions-inbox/         # NEW — corporate-action prompts, dividend receipt tracking, revoke history
    journal-entries/ prompts/  # REMOVE (OneQ)
packages/
  finance-math/            # NEW — XIRR/TWR/Sharpe/shadow-portfolio, pyxirr port, decimal utils
  zod-schemas/             # EXTEND — shared import/domain schemas
  ui-mui/                  # KEEP
```

**Offline-first sync (Dexie/IndexedDB, pull-bundles, service-worker sync): NOT used for portfolio data.** Portfolio analytics are server-computed over the full ledger; a partial offline copy would show wrong numbers. The PWA shell stays (installability, notifications); the sync worker infrastructure remains compiling but unwired for Kosh entities. (If an offline read-only dashboard snapshot is ever wanted, it's a cached API response, not a synced database.)

## 3. The three-layer data architecture

The load-bearing design. Every feature slots into one of these layers.

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1 — RAW (immutable, append-only)                          │
│  import_files (verbatim uploads)  provider_payloads (feed pulls) │
│  raw_trades, raw_ledger_lines, raw_holdings — exactly as broker │
│  reported: original symbols, pre-split qty/price, provenance FK  │
│  Rows are never edited; a re-upload SUPERSEDES an older batch.   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ validation gate (schema → referential → plausibility)
                           │ rejects → quarantine, never half-applied
┌──────────────────────────▼──────────────────────────────────────┐
│ LAYER 2 — EVENTS (the interpretation, source of truth)          │
│  instrument master (ISIN-keyed, time-ranged aliases)            │
│  corporate_action_events + per-account applications             │
│  cash-flow classifications (external / internal-transfer pair)  │
│  dividend expectations + receipt confirmations                  │
│  user resolutions to prompts — and RETRACTIONS (events that     │
│  supersede other events; nothing is ever deleted)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ deterministic replay (versioned, cache-keyed by input hash)
┌──────────────────────────▼──────────────────────────────────────┐
│ LAYER 3 — DERIVED (disposable, rebuildable)                     │
│  positions & lots, adjusted qty/price views, daily valuation    │
│  snapshots, metric results, shadow portfolios, trails           │
│  Never hand-edited. Invalidated & replayed when L1/L2 change.   │
└─────────────────────────────────────────────────────────────────┘
```

### Retraction mechanics (owner directive)

- Every Layer-2 event and every import batch carries `superseded_by_event_id` (nullable). A **retraction is a new event** pointing at its target, with reason + actor + timestamp. Queries read "live" events as `WHERE superseded_by_event_id IS NULL`.
- Import batches retract **as a unit**: retracting a batch supersedes all rows it produced.
- Derived data never needs retraction — it is recomputed. The replay is triggered by an outbox-style invalidation: any L1/L2 write enqueues a `recompute(account_ids, from_date)` job (pg-tbus).
- The audit question "what changed and why" is answerable from the event table alone.

### Validation gate (owner directive)

Three tiers, run in order, applied to *every* input (file, feed row, user entry):
1. **Schema**: columns/types/date formats parse; totals rows and header junk stripped.
2. **Referential**: instrument resolvable (ISIN or alias), account exists, dates within account lifetime.
3. **Plausibility**: non-negative quantities where required, price within N×σ of the day's bar, ledger lines balance to statement totals, duplicate trade-ids flagged, corporate-action ratios yield integral-or-explained holdings.

A file is applied **atomically or not at all**. Failures land in `import_quarantine` with machine-readable reasons, surfaced in the imports UI for correction and re-submission.

## 4. Backend processing model

- **oRPC procedures** (existing pattern) for all UI-facing reads/writes.
- **pg-tbus jobs** (existing infra) for: import parsing/validation, derived-layer replay, daily market-data ingestion (bhavcopy ~6pm IST, AMFI NAV, FX, TRI refresh), dividend-feed polling, corporate-action feed polling.
- **Metric queries are served from Layer 3** (valuation snapshots + cached metric results keyed by `(account_set_hash, date_range, metric, params_hash, ledger_version)`); a cold cache computes on demand from snapshots — target < 1s for a 10-year, 10-account family.
- **Novu notifications** for: new corporate-action prompts, dividend confirmations due, import failures, stale data.

## 5. Security & tenancy

- Statements are sensitive financial documents: stored via the existing files module, encrypted at rest (storage-level), scoped to the family (team) with the existing strict `teamId` scoping patterns (ADR-012).
- No broker credentials exist in v1 (file drop only). When the API phase arrives, tokens get envelope encryption + a dedicated secrets table — out of scope now.
- Multi-family (multi-tenant) support comes free from the teams module *if* the access-model grilling confirms family=team.

## 6. Frontend architecture

- **Dashboard** is a pure function of `(selected account set, date range, metric selection)` → one oRPC query returning tiles + series + per-account breakdown. Selection state in URL params (shareable views).
- **Charts**: portfolio value vs shadow portfolios (NIFTY TRI, gold) as the hero chart; drawdown and allocation as secondary. Follow the repo's MUI system.
- **Every number is expandable**: metric tiles open a "how was this computed" panel fed by the trail attached to each derived figure (see [03-metrics-spec.md](./03-metrics-spec.md) §6).
- **Imports UX**: upload → server dry-run → per-row preview with statuses (new / duplicate / error) → confirm → batch applied. Quarantine tab lists rejects with reasons.
- **Actions inbox**: pending corporate-action prompts (with effect preview), dividend receipt confirmations, plus an applied-actions history with revoke.

## 7. Open architecture questions (tracked on the map)

- Family/login/permission model → [Grilling: Family, accounts & access model](https://github.com/krishna-404/family-portfolio-tracker/issues/2).
- Foreign/crypto platforms, FX-rate source, benchmark set for foreign sleeves → [Grilling: Foreign assets, crypto & currency model](https://github.com/krishna-404/family-portfolio-tracker/issues/15).
- Remaining asset classes (MFs beyond CAS, bonds, SGBs, manual assets) → [Grilling: Asset-class scope](https://github.com/krishna-404/family-portfolio-tracker/issues/4).
- Sharpe parameters and fee-schedule shapes → [Grilling: Metrics & date-range semantics](https://github.com/krishna-404/family-portfolio-tracker/issues/5).
