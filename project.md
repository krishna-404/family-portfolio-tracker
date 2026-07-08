# Kosh — Family Portfolio Tracker

**Name: Kosh** (कोष — "treasury")

**The Problem:** Indian families hold investments scattered across many broker accounts — different family members, different brokers (Zerodha, Dhan, Groww), often managed by an external fund manager. Nobody can see the consolidated picture, and every broker misreports returns: they compute from trade dates and ignore when money actually entered or left the account, dividends that bypass the broker ledger, corporate actions, and the full weight of charges and fees.

**The Solution:** One place where a family connects all its broker accounts (statement file-drop in v1, APIs later) and sees **true, fund-flow-based performance**:

- **Hero metric**: the shadow portfolio — *"had I invested the same amounts, at the same cadence, in NIFTY / gold, what would it be worth today? Did the fund manager beat passive?"*
- XIRR, IRR, TWR, Sharpe and friends — for any account or any custom group of accounts, over any date range.
- Returns net of all trading charges (brokerage, STT, GST, stamp duty) and fund-manager fees, pre-income-tax.
- Dividends tracked from public feeds with receipt confirmation; corporate actions (splits, bonuses, mergers, demergers, renames) applied automatically or via user prompts.
- Foreign investments and crypto included, converted through an FX layer into INR. Long-term investments only — no F&O, no intraday.

**Users:** the family (a Kosh *family = team*): family members and their fund manager are team members with access to the shared dashboards.

**Architecture principles** (non-negotiable):
1. **Fund-flow ground truth** — metrics anchor to deposits/withdrawals, never trade dates.
2. **Three layers** — immutable raw imports → corporate-action/classification event log → deterministically rebuildable derived data.
3. **Every action retractable** — retraction is a superseding event; the derived layer replays. No destructive edits.
4. **Validate before acting** — schema/referential/plausibility gates; rejects quarantined, imports atomic.
5. **Explainable numbers** — every figure expands into the flows and events behind it.

**The full plan** lives in [`docs/kosh/`](./docs/kosh/00-product-brief.md): product brief, architecture, domain model, metrics spec, ingestion spec, and roadmap. Decision log: the [wayfinder map](https://github.com/krishna-404/family-portfolio-tracker/issues/1). Prior-art research: [`docs/research/prior-art.md`](./docs/research/prior-art.md).

## Technical foundation

Built on this repo's full-stack TypeScript monorepo: oRPC + Orchid ORM + PostgreSQL + pg-tbus backend; React 19 + Vite + MUI PWA frontend; Better Auth (family = team); Novu notifications. The boilerplate's offline-first Dexie sync is **not** used for portfolio data (analytics are server-computed); the PWA shell and file-upload infrastructure are retained. One Python tool — casparser, for CAS PDF parsing — runs as a pinned CLI subprocess; everything else is TypeScript.
