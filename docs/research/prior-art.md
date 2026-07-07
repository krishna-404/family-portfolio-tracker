# Prior art: open-source portfolio trackers & Indian data ecosystem

Comparative survey feeding the Kosh research tickets ([broker export formats](https://github.com/krishna-404/family-portfolio-tracker/issues/8), [market data](https://github.com/krishna-404/family-portfolio-tracker/issues/9), [metric computation](https://github.com/krishna-404/family-portfolio-tracker/issues/10)). Surveyed 2026-07-07: [kite_pnl](https://github.com/NeverInAsh/kite_pnl) (user-suggested), [Ghostfolio](https://github.com/ghostfolio/ghostfolio), [Portfolio Performance](https://github.com/portfolio-performance/portfolio), and the Indian market-data library ecosystem.

**Headline: Kosh's core thesis is validated by both major projects' biggest wounds.** Neither has fund-flow XIRR + an authoritative corporate-action event log + an immutable raw layer. Ghostfolio has no IRR at all and models cash as a mutable balance (so deposit history is unrecoverable); Portfolio Performance has excellent fund-flow XIRR but applies splits by destructively rewriting every historical transaction, irreversibly. Neither does shadow-portfolio benchmarking ("same cash flows into the index") — both only overlay a re-based benchmark price line. Kosh's design occupies exactly the intersection both communities keep asking for.

---

## 1. kite_pnl (NeverInAsh) — the user-suggested reference

A ~360-line Python script from 2018 (2 commits, abandoned): recomputes Zerodha tradebook P&L with split/bonus back-adjustment, because Kite's own P&L screen misstated returns around corporate actions (its README's Vakrangee example is market validation for Kosh).

**Right ideas (borrow the concepts):**
- Merge corporate actions from multiple sources (Moneycontrol + BSE) into one normalized event schema `(symbol, ex_date, type, old, new)` — confirms no single Indian corp-action feed is complete.
- Back-adjust only trades strictly before the ex-date, conserving cost basis.

**Failure-mode checklist (each maps to a Kosh principle):**
| Bug | Kosh counter-design |
|---|---|
| Mutates the trade DataFrame in place; overwrites raw BSE download on disk | Immutable raw layer; adjustments live as events |
| Ex-date matched with `==` (adjustment silently skipped unless you traded on the exact ex-date) | Apply to all trades `< ex_date`; property-test date semantics |
| Bonus math ignores the `old` term (wrong for any ratio ≠ 1:N; test with WIPRO 1:1, ICICIBANK 1:10, 32:21 cases) | Correct ratio math + unit tests against known events |
| Mixes `split_date` / `record_date` / `ex_date` across sources | Ex-date vs record-date explicit per event, per source |
| Ticker-string symbol matching across NSE/BSE names | ISIN-keyed instrument master |
| `except: pass` around money math; zero reconciliation | Fail loudly; reconcile derived holdings vs broker-reported |
| Tradebook-only input → no fund flows, no XIRR, no valuations | Ledger is the ground-truth input; EOD prices mandatory |
| Selenium scrapers rotted with site redesigns | Stable structured sources; cache raw snapshots for reproducibility |

## 2. Ghostfolio — TypeScript/NestJS/Prisma (AGPL-3.0)

Closest to Kosh's stack; most instructive as an anti-pattern catalog, with a few gems.

**Model**: one flat `Order` table (`BUY DIVIDEND FEE INTEREST LIABILITY SELL`) — no lots, no raw layer, hard deletes. **No DEPOSIT/WITHDRAWAL type**: cash is a mutable `Account.balance` + dated snapshots, so fund-flow history is unrecoverable and money-weighted return is impossible (the `MWR`/`TWR`/`ROI` calculator classes literally `throw new Error('Method not implemented')`; only a bespoke "ROAI" metric exists, with a years-long trail of "wrong performance" issues). **No corporate-action model at all** — split handling is "manually edit every activity" (issue #2722 closed as not-planned; #6271 shows 200% phantom ROI after a reverse split). Money stored as `Float` (precision bugs). FX hardcoded through a USD pivot with silent fallback to *unconverted values* on missing rates. Duplicate detection = exact equality of every field (brittle, #6057).

**Worth borrowing:**
- **Dry-run-first import API**: `?dryRun=true` returns parsed rows each carrying `error: {code}` for a preview/confirm UI — the right API surface for Kosh's validate-before-apply.
- Dividend-suggestion flow: provider dividend history × holdings at ex-date → pre-flagged proposed entries (maps directly onto Kosh's dividend receipt-tracking).
- `(dataSource, symbol)` asset identity + user-level display overrides + symbol aliasing table.
- Queue-based snapshot computation (Bull/Redis) — right shape for the rebuildable derived layer (but persist snapshots with an input-version hash).
- Full JSON export/import round-trip as cheap backup/portability.

## 3. Portfolio Performance — Java desktop (the deepest model)

**Steal this transaction model.** Verified in source:

- **Double-entry `CrossEntry`**: every buy/sell is a paired portfolio-leg + cash-leg; transfers are paired in/out; deleting one leg deletes the other. `DELIVERY_INBOUND/OUTBOUND` (securities enter/leave with no cash counterpart) vs `BUY/SELL` distinction is load-bearing: deliveries are *external* flows in return math.
- **The `Transaction.Unit` model**: `{type ∈ GROSS_VALUE|TAX|FEE, amount (txn currency), forex (other currency), exchangeRate}` with constructor-enforced `amount ≈ forex × rate` tolerance — one transaction simultaneously true in account currency (INR) and security currency (USD/crypto), with fees/taxes itemized. Kosh should extend the type enum: STT, STAMP_DUTY, GST, BROKERAGE, TDS. Recorded trade-time FX beats table FX for flows; table FX for valuations; difference surfaces as currency gains.
- **Fixed-point longs**: 2-decimals money, 8-decimals shares/quotes. Never floats.
- **`ClientIRRYield` is exactly Kosh's fund-flow XIRR**: −valuation at start; then *external flows only* (DEPOSIT, REMOVAL, TRANSFER, DELIVERY); +valuation at end; buys/sells/dividends/fees explicitly skipped as internal; and a `default: throw` so any new transaction type must be classified external-vs-internal before returns compile. Copy that defensive pattern.
- **Import pipeline**: extractor → typed items → ordered validation actions (date → type-validity → security-consistency → duplicates → currency → FX arithmetic) → human preview grid with per-row status → insert through the same interface. **Two-tier duplicate detection**: exact (day+amount+shares+security, with type-equivalence sets like DEPOSIT≍TRANSFER_IN) plus fuzzy (±1% amount, ±10% qty, +5 days) for expected recurring flows. ~130 broker PDF extractors each shipping anonymized regression fixtures — the fixture discipline is what keeps parsers alive. India-relevant ready-made references: `KFintechPDFExtractor` (CAS), `AMFIIndiaQuoteFeed`, `MFAPIQuoteFeed`.
- **`TrailRecord`**: every derived figure carries an audit trail the UI can expand ("explain this number") — the antidote to "XIRR looks wrong" support threads. Kosh's derived layer should emit the flow list behind every XIRR.

**Its great failure — corporate actions**: the split wizard *rewrites every prior transaction's share count and every historical price in place*, and deleting the split event reverts nothing (issue #4223, forum "Stock Split cancellation"). Mergers/spin-offs are user folklore ("fake a dividend and a buy"). Its `SecurityEvent` log is descriptive, not authoritative — the exact trap Kosh's event layer avoids by making events the source of truth that derived data replays from. Also: single-file XML persistence needed a protobuf rescue at 1.3M price rows and 70 in-place schema migrations — use a real database from day one (we have Postgres).

## 4. Indian data ecosystem — verdicts

| Component | License | Health | Verdict for Kosh |
|---|---|---|---|
| [casparser](https://github.com/codereverser/casparser) (CAMS/KFintech CAS PDFs → typed JSON: folios, holdings, full txn history, ISIN mapping) | MIT | Excellent (v1.3.0, Jul 2026) | **Use** — wrap as Python sidecar/CLI; don't port 339 commits of edge cases. Gives MF coverage across all brokers in one shot |
| [pyxirr](https://github.com/Anexen/pyxirr) (Rust/Python XIRR: multi-guess fallback, lowest-rate selection, `zero_crossing_points`, day-count conventions) | Unlicense | Active | **Port its algorithm to TS** — public domain, zero friction; no npm package matches it. Validate against Excel fixtures |
| [@webcarrot/xirr](https://github.com/webcarrot/xirr) (TS port of LibreOffice XIRR) | MIT | Quiet | Fallback/reference if porting stalls |
| [nselib](https://github.com/RuchiTanmay/nselib) (NSE bhavcopy, OHLCV, corporate actions) | Apache-2.0 | Active | **Use/reference** — best-licensed Python NSE wrapper |
| [stock-nse-india](https://github.com/hi-imcodeman/stock-nse-india) (NSE APIs in TypeScript, npm) | MIT | Active (v1.4.0, May 2026) | **Natural TS starting point** for NSE access |
| [BharatFinTrack](https://github.com/debpal/BharatFinTrack) (NIFTY TRI + PRI downloader) | MIT | Active (Jun 2026) | Reference for the TRI endpoint (below) |
| jugaad-data | non-standard "YOLO" | Reactive | Skip (license risk); nsepy dead; nsepython GPL-3.0 → learn-only |
| Broker statement parsers (Zerodha/Groww/Dhan) | — | Hobby-grade only | **Build** — nothing production-grade exists; this is Kosh's gap to own |

**Source-level facts that shape the ingestion design:**
- NSE's JSON APIs sit behind Akamai bot protection (cookie bootstrap, browser headers), rename endpoints without notice (two renames in the past year), and **block cloud-server IPs**. Bulk **bhavcopy files are the stable primitive** — use them as the canonical daily EOD source; per-symbol APIs for backfill only.
- Corporate actions: NSE `api/corporates-corporateActions` gives ex-date + record-date + a free-text `subject` ("Bonus 1:1", "Face Value Split…") — **ratio/amount extraction from that free text is the real work and no library does it robustly**. BSE's equivalent is the cross-check; pay dates are best-effort (announcements only).
- MF NAVs: **AMFI direct** (`NAVAll.txt` daily, no bot protection) for production; mfapi.in for dev.
- NIFTY TRI: `POST niftyindices.com/Backpage.aspx/getTotalReturnIndexString` returns full daily TRI series (~30 lines of TS); equity indices only — debt/gilt fall back to the price endpoint; cache aggressively, history is immutable.
- Gold: IBJA daily rates via a small HTML-table scrape (SGB valuation officially uses IBJA 999, so it's the right series). FX: RBI/FBIL reference rates (DBIE) or self-hosted frankfurter.app.
- Comparable products to study: [folioman](https://github.com/codereverser/folioman) (AGPL — learn-only; CAS-centric family views), krishnakuruvadi/portfoliomanager (GPL — learn-only), tomelam/PortfolioAnalyzer (niftyindices endpoint forensics).

## 5. Consolidated implications for Kosh

**Decisions validated by this survey:** immutable raw + event log + derived replay (both big projects' worst wounds trace to violating it); fund-flow ground truth (PP proves the math works; Ghostfolio proves its absence is fatal); dividends from public feeds with receipt tracking (Ghostfolio's dividend-suggestion flow is precedent); retractability (PP's irreversible split wizard is the cautionary tale); validate-before-acting (PP's ordered check actions + preview grid is the template); shadow-portfolio hero metric (genuinely unserved — and it consumes the same external-flow list the XIRR engine produces, so build both on one flow extractor).

**Concrete adoption list:**
1. Transaction model: PP's CrossEntry double-entry + Unit (GROSS_VALUE/TAX/FEE with per-transaction FX) + external-vs-internal flow taxonomy with `default: throw`; fixed-point/NUMERIC money, never floats.
2. Import: PP's pipeline shape + two-tier dedupe, exposed through Ghostfolio-style dry-run JSON; add what both lack — broker/exchange transaction IDs or content hashes as idempotency keys, and an **import-batch ID so every import is atomically retractable** (our retractability directive, applied to imports).
3. Metrics: port pyxirr's solver strategy to TS; PP's `ClientIRRYield` as the XIRR flow-construction reference; PP's TTWROR daily-linking convention as the TWR reference; **never invent a bespoke headline metric** (Ghostfolio's ROAI saga); attach a TrailRecord-style "explain this number" trail to every derived figure.
4. Data: bhavcopy + AMFI + niftyindices TRI endpoint + IBJA scrape + RBI/frankfurter FX; casparser sidecar for CAS; store provider payloads immutably with provenance.
5. The three gaps nobody has solved — broker-statement normalization across Zerodha/Groww/Dhan, corporate-action free-text ratio parsing, and fund-flow-true XIRR semantics — are Kosh's differentiation. Budget design time accordingly.
