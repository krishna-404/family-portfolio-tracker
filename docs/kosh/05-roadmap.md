# Kosh — Build Roadmap

Phased so that every milestone ends with something the family can actually use, and so the riskiest invariants (fund-flow truth, retractability) are proven early on real data. Each milestone lists acceptance criteria — the definition of done an implementer (human or agent) verifies against.

Open grillings gate only the milestones that name them; M0–M2 can start immediately.

---

## M0 — Foundation reset  *(ticket [#13](https://github.com/krishna-404/family-portfolio-tracker/issues/13); unblocked)*

Strip OneQ (journal-entries, prompts modules, gamification, seeds, copy), rebrand to Kosh, rewrite `project.md` from [00-product-brief.md](./00-product-brief.md). Keep auth/teams/files/notifications/jobs/observability. Sync infra stays compiling but unwired for Kosh entities.

**Accept:** `yarn lint`, `yarn check-types`, build green; app boots showing a Kosh shell; zero journaling references outside git history.

## M1 — Ledger core & first import (Zerodha)  *(needs sample exports, ticket [#14](https://github.com/krishna-404/family-portfolio-tracker/issues/14))*

Schema for persons/accounts/groups, Layer-1 tables, events spine, instruments + aliases, trades + charge units, cash_flows + classification rules. Zerodha adapters (tradebook, ledger, holdings) with fixtures. Import pipeline: dry-run preview, atomic apply, quarantine, batch retraction. Backfill wizard v1 with gap detection.

**Accept:** a real multi-year Zerodha account imports to "history complete"; ledger balance reproduction passes; re-uploading the same file yields 100% duplicates and zero new rows; retracting a batch then re-importing produces byte-identical Layer 2; every raw row traceable to file + batch.

## M2 — Market data & valuations

`price_bars` (1d), bhavcopy + AMFI + TRI + IBJA + FX jobs with `provider_payloads` immutability; instrument resolution against bhavcopy master; `valuation_snapshots` + FIFO lots + `positions_daily`; `ledger_versions` + replay job.

**Accept:** daily job populates bars unattended for a week; any account shows a daily value series from inception; replay after an injected Layer-2 change converges; missing-price days visibly forward-filled and flagged in trails.

## M3 — Metrics engine & dashboard  *(the first "wow" release)*

`packages/finance-math`: decimal utils, pyxirr-port solver, flow extractor, XIRR/IRR/TWR/vol/Sharpe/Sortino/drawdown, trails. Dashboard: account/group selector, date-range presets + custom, metric tiles (user-selectable), per-account breakdown table, **shadow-portfolio chart vs NIFTY TRI & gold with the headline "vs passive" delta**. Saved groups.

**Accept:** XIRR matches Excel to 1e-6 on the fixture set; internal-transfer scenario (Dad→Son) shows correct per-account vs group metrics; every tile expands to its trail; shadow XIRR uses identical flows; sub-second warm queries on a 10-year × 10-account family.

## M4 — Corporate actions & reconciliation  *(prompts UX shaped by grilling [#6](https://github.com/krishna-404/family-portfolio-tracker/issues/6))*

CA feed ingestion (NSE+BSE cross-check), purpose-string grammar parser with confidence routing, auto-application with effect preview, actions-inbox, applied-history with revoke, `reconciliation_diffs` against holdings snapshots, adjustment factors + adjusted views, `instrument_links` for renames/mergers/demergers.

**Accept:** WIPRO-1:1+split fixture set passes; a wrong-ratio apply→retract→re-apply heals Layer 3 (scenario 5); an unexplained holding raises a prompt within one reconciliation cycle; metrics badge "unreconciled" while prompts are pending.

## M5 — Dividends & fees

Dividend expectations from feed × record-date holdings; receipt tracking (date + txn id); metric integration (receipt-date, pay-date fallback, unconfirmed badge). Fee schedules (shapes per grilling [#5](https://github.com/krishna-404/family-portfolio-tracker/issues/5)) + synthetic fee flows; **gross vs net toggle everywhere**.

**Accept:** dividend-heavy account's XIRR visibly includes dividends with correct dating; gross−net delta equals fees paid in a hand-checked fixture; unconfirmed dividends surface in inbox and trails.

## M6 — Groww & Dhan adapters + CAS

Remaining broker adapters with fixtures; casparser subprocess integration for CAS (MF coverage across all brokers); cross-broker dedupe (same trade via two exports).

**Accept:** all family accounts imported; a CAS file yields MF holdings + transactions passing the same gate; person-level rollups (multi-broker) correct.

## M7 — Foreign & crypto  *(gated on grilling [#15](https://github.com/krishna-404/family-portfolio-tracker/issues/15))*

FX layer completion, foreign-platform + crypto-exchange import adapters, native-vs-INR return decomposition, foreign/crypto benchmarks, 24/7 EOD cutoff.

**Accept:** scenario 4 (USD holding INR-true return incl. remittance forex cost) passes; family "everything" view includes foreign + crypto sleeves.

## M8 — Hardening & polish

Multi-user access per grilling [#2](https://github.com/krishna-404/family-portfolio-tracker/issues/2) (family members, fund-manager role), Novu notifications for prompts, PWA polish, encrypted-at-rest verification, performance passes, docs.

---

## Standing build rules (apply to every milestone)

1. Layer discipline: nothing writes the ledger except the import pipeline and event application. Derived tables are never hand-written.
2. Every adapter/parser lands with anonymized fixtures; every metric with Excel-verified fixtures; kite_pnl's bug list is a permanent regression suite ([prior-art](../research/prior-art.md) §1).
3. NUMERIC/decimal end-to-end; a lint rule bans `number` arithmetic on money types in `finance-math` consumers.
4. Every new `cash_flows.classification` or event kind must be added to the exhaustive external/internal switch or the build fails.
5. Wayfinder hygiene: decisions land on the [map](https://github.com/krishna-404/family-portfolio-tracker/issues/1); these docs are updated in the same PR as the code that implements them.
