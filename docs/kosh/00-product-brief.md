# Kosh — Product Brief

> **Kosh** (कोष, "treasury") — the family's wealth, consolidated, with returns you can trust.

## The problem

Indian families hold investments scattered across many broker accounts — different family members, different brokers (Zerodha, Dhan, Groww), often managed by an external fund manager. Nobody can see the consolidated picture, and worse: **every broker and most tools misreport returns**, because they compute from trade dates and ignore when money actually entered or left the account, dividends that bypass the broker ledger, corporate actions, and the full weight of charges and management fees.

## The product

A self-hosted web app (this monorepo) where a household:

1. **Connects accounts by file drop** (v1): uploads broker back-office exports — tradebook, ledger/funds statement, holdings, contract notes. Official broker APIs come in a later phase.
2. **Backfills full history**: every account is imported back to inception from statements. No shortcuts.
3. **Reviews true performance** for any account or any custom group of accounts ("Parents", "Kids", "Everything"), over any date range:
   - **Hero metric**: the shadow portfolio — *"had I invested the same amounts, at the same cadence, in NIFTY / gold / etc., what would it be worth today? Did the fund manager beat passive?"*
   - Supporting metrics, all user-selectable: **XIRR** (money-weighted, the family's outcome), **TWR** (time-weighted, the fund manager's skill), IRR, Sharpe, drawdown, volatility.
4. **Gets returns that are actually true**:
   - Cash-flow ground truth = **deposits/withdrawals into the account**, not trade dates.
   - Net of **all trading charges** (brokerage, STT, GST, stamp duty, exchange fees — from broker data) and **fund-manager fees** (user-entered), pre-income-tax.
   - **Dividends** sourced from public corporate-action feeds (they never touch the broker ledger), receipt-tracked by the user, counted at receipt date (fallback: reported pay date).
   - **Corporate actions** (splits, bonuses, mergers, demergers, renames, buybacks, delistings) applied automatically where data allows, otherwise queued as user prompts.
5. **Covers the whole portfolio**: Indian equities/ETFs, foreign investments, and crypto — everything converted through an FX layer into the base currency (INR). Long-term investments only: **no F&O, no intraday**.

## Users

- **The operator**: the family member (or fund manager) who uploads statements and answers prompts.
- **Family members**: view dashboards. *(Exact login/permission model: open — [Grilling: Family, accounts & access model](https://github.com/krishna-404/family-portfolio-tracker/issues/2).)*

## Non-negotiable principles (owner directives)

1. **Fund-flow ground truth.** Every return metric is anchored to external cash flows, never trade dates.
2. **Every action is retractable.** Wrong or poisoned data — a bad feed row, a mis-ratioed split, a wrong user answer — is revoked by a superseding retraction event; derived data replays to the corrected state. No destructive edits, ever.
3. **Validate before acting.** No input mutates state until it passes schema, referential, and plausibility checks. Rejects are quarantined for review — never silently dropped, never half-applied.
4. **Explainable numbers.** Every displayed figure can expand into the exact flow list and events behind it.
5. **Standard, verifiable metrics.** XIRR must match Excel's on the same flows. No bespoke headline metrics (see Ghostfolio's ROAI cautionary tale in [prior-art](../research/prior-art.md)).

## Out of scope

- Income-tax computation (returns are pre-tax by design).
- Order placement / trade execution — Kosh is read-only analytics.
- F&O and intraday.
- Broker API connectivity (deferred phase; file drop first).
- The boilerplate's previous product (OneQ journaling) — removed.

## Where the plan lives

| Doc | Contents |
|---|---|
| [01-architecture.md](./01-architecture.md) | System architecture, monorepo mapping, three-layer data design, Python-sidecar decision |
| [02-domain-model.md](./02-domain-model.md) | Full draft schema: tables, columns, invariants |
| [03-metrics-spec.md](./03-metrics-spec.md) | Formulas and algorithms: XIRR, TWR, Sharpe, shadow portfolio |
| [04-data-ingestion.md](./04-data-ingestion.md) | Broker-file import pipeline, market-data ingestion, corporate-action feed |
| [05-roadmap.md](./05-roadmap.md) | Phased build plan with acceptance criteria |

Decision log and open questions: the [wayfinder map](https://github.com/krishna-404/family-portfolio-tracker/issues/1). Prior-art research: [docs/research/prior-art.md](../research/prior-art.md).
