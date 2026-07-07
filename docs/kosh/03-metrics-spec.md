# Kosh — Metrics Specification

All metrics compute over a **selection** `S` (any set of accounts) and a **window** `[A, B]`. Inputs come exclusively from Layer 2/3: `cash_flows` (external classifications only), `valuation_snapshots`, `dividend_expectations`, `fee_schedules`. All computation in `packages/finance-math` on decimal arithmetic (integer paise / scaled BigInt or a vetted decimal lib — never IEEE floats end-to-end).

## 1. The flow extractor (shared by XIRR and shadow portfolios)

```
flows(S, A, B) :=
  [ (A, −V(S, A)) ]                                    -- opening valuation as pseudo-outflow (skip if account born after A)
  ++ [ (t, −f.amount_inr) for external_deposit f in (A, B] ]
  ++ [ (t, +f.amount_inr) for external_withdrawal f in (A, B] ]
  ++ dividend flows per policy (§4)
  ++ external fund-manager fee flows (§5)
  ++ [ (B, +V(S, B)) ]                                 -- closing valuation
```
- `V(S, d)` = Σ over accounts of `valuation_snapshots` (securities at that day's close × FX + ledger cash). Non-trading days use the last prior snapshot.
- **Internal transfers between two accounts both ∈ S cancel and are excluded; if only one side ∈ S, that leg is external for this selection.** This single rule makes per-account, per-person, and family-level metrics mutually consistent.
- Exhaustive-switch rule: any `cash_flows.classification` not explicitly mapped external/internal/ignored ⇒ computation refuses to run (compile-time + runtime guard). Never silently misclassify.
- Sign convention: investor's pocket. Money in = negative, money out/value held = positive. XIRR result then reads as investor return.

## 2. XIRR (money-weighted; the family's outcome)

`XIRR(flows) = r` such that `Σ cf_i × (1+r)^(−d_i/365) = 0`, `d_i` = days since first flow (ACT/365F, matching Excel).

**Solver (port of pyxirr's strategy — Unlicense):**
1. Detect degenerate inputs: all-same-sign flows → error `NO_SIGN_CHANGE`; <2 flows → error; same-day-only flows → error.
2. Newton–Raphson from guess 0.1 with analytic derivative; bounded to r > −1.
3. On non-convergence: bracket scan over a fixed grid, then Brent's method on each sign-change bracket.
4. Multiple roots (flows change sign >1 time — common after big redemptions): compute `zero_crossing_points`, solve each bracket, **return the lowest rate** (conservative) and attach a `MULTIPLE_ROOTS` diagnostic to the trail.
5. Never return a silent non-converged iterate: result is `{value, status: converged|no_solution|multiple_roots, iterations}` (Portfolio Performance's silent-Newton is the anti-pattern).

**IRR** (user asked for it distinctly): same solver on the same flows bucketed to regular periods (monthly), reported as annualized periodic IRR. Labeled clearly in UI as "IRR (monthly-bucketed)"; XIRR is the primary money-weighted figure.

**Test fixtures**: must match Excel/LibreOffice `XIRR` to 1e-6 on a shared fixture set, including: single deposit + final value; SIP-style monthly flows; large mid-period withdrawal; sign-flipping sequence (multiple roots); >20-year span; same-day opposing flows.

## 3. TWR (time-weighted; the fund manager's skill)

True daily-linked TWR from snapshots (Modified Dietz only as documented fallback where a valuation is missing):

```
r_t = (V_t + out_t) / (V_{t−1} + in_t) − 1        -- inflows at start of day, outflows at end (PP convention)
TWR(A,B) = Π (1 + r_t) − 1 ;  annualized: (1+TWR)^(365/days) − 1
```
- `in_t`/`out_t` are the same external flows from §1 dated to day t.
- Zero-denominator days (account empty) contribute r=0 and are flagged in the trail.
- Display XIRR and TWR side by side with one-line captions: *"XIRR — your money's growth, timing included"* / *"TWR — manager skill, deposit timing removed"*.

## 4. Dividends in returns (owner decision, ticket #3)

- On `dividend_receipt_confirmed`: a flow at `receipt_date` for `receipt_amount`.
- Unconfirmed but past `pay_date`: a flow at `pay_date` for `expected_amount`, and the metric's trail is badged **"includes N unconfirmed dividends"**.
- Semantics: dividends are money returned to the investor's pocket → they enter `flows()` as withdrawals-equivalent (+, investor received) — they *increase* XIRR, matching the "true return" intuition. Account value never includes pending dividends.
- Buyback/delisting proceeds settling to bank: same pattern (pending confirmation in grilling #3).

## 5. Fund-manager fees: gross vs net

- Fees paid **from within** the account (ledger debits) are already inside the flow/valuation math → captured automatically.
- Fees paid **outside** (invoiced separately) become `fee_external` flows (money out of the investor's pocket into the manager's — enter as deposits-equivalent (−) at payment date).
- Accrual-model schedules (`pct_aum_pa`, `profit_share`) generate *synthetic* fee flows for the **net** variant only.
- Every metric computes twice: **gross** (fee flows excluded) and **net** (included). The dashboard toggle answers "what did the manager cost me": `gross XIRR − net XIRR`.

## 6. Shadow portfolio (the hero metric)

For benchmark `β` (NIFTY 50 TRI, gold via IBJA, Sensex, ⚠ foreign/crypto benchmarks per grilling #15):

```
units := 0; for each external flow (t, cf) in flows(S, A, B) excluding the valuation pseudo-flows:
    units += (−cf) / β_price(t)          -- deposits buy benchmark units, withdrawals sell them
shadow_V(d) = units(d) × β_price(d)      -- a full daily series, not just endpoints
```
- Uses **TRI** for indices (dividends reinvested) — price-index comparison would flatter the manager.
- Non-trading-day flows execute at the next available benchmark price (documented in trail).
- Outputs: shadow value today, shadow XIRR (same solver, same flows, shadow terminal value), and the headline delta: **"Fund manager vs NIFTY: +₹X / +Y% XIRR"** — computed gross *and* net of fees.
- Chart: portfolio `V(d)` overlaid with each `shadow_V(d)` over the window.

## 7. Risk metrics

From the daily **flow-adjusted return series** `r_t` of §3 (never raw value changes — deposits are not gains):
- **Volatility**: stdev(r_t) × √252.
- **Sharpe**: `(annualized TWR − rf) / volatility`. Risk-free `rf` ⚠ default proposal: 91-day T-bill yield series (configurable constant fallback), pending grilling #5.
- **Sortino**: downside deviation denominator.
- **Max drawdown**: on the TWR-indexed series (flow-adjusted), with peak/trough dates in the trail.
- Windows shorter than 90 days display risk metrics greyed with "insufficient sample" badge.

## 8. Trails (owner directive: explainable numbers)

Every computed figure persists a `trail`: the exact flow list (with links to source ledger lines/events), valuations used, FX rates applied, solver diagnostics, unconfirmed-dividend and missing-price warnings, and the `ledger_version`. The UI renders it as an expandable "How was this computed?" panel; it doubles as the audit artifact for verifying against Excel.

## 9. Caching & invalidation

`metric_results` keyed by `(account_set_hash, from, to, metric, params_hash, ledger_version)`. Any Layer-1/2 write bumps `ledger_version` → stale keys die naturally; recompute lazily on read, eagerly (pg-tbus) for the family's saved default views.
