# Broker export formats

Working document for [Research: Broker statement/export formats](https://github.com/krishna-404/family-portfolio-tracker/issues/8). Derived from **real exports** provided by the owner (kept out of the repo — they contain personal financial data; anonymized fixtures will be derived for adapter tests). Groww and Dhan sections pending their samples.

## Zerodha (Console exports)

Seven export types examined (FY 2025-26 / 2026-27 samples, single account). General quirks that shape the adapters:

- **XLSX files have broken dimension metadata** — openpyxl `read_only` mode sees `A1:A1`; parsers must do a full read / `reset_dimensions()`. Any streaming-XLSX library will need the same workaround.
- **Every XLSX sheet carries a preamble**: a "View Zerodha's guide…" row, then a Client ID / Client Name / PAN block, then a title row, before the real header. Parsers locate the header row by content, not position. Footer rows (totals, explanatory notes) must be stripped — the validation gate's schema tier handles both.
- Statement files are named `<type><CLIENT_ID><suffix>` (e.g. `tradebook<ID>EQ.csv`, `dividends<ID>2025_2026.xlsx`) — the client id in the filename is a useful account-routing hint at upload time.

### 1. Tradebook (CSV) — `raw_trades` source

Header: `symbol, isin, trade_date, exchange, segment, series, trade_type, auction, quantity, price, trade_id, order_id, order_execution_time`

- One row per **fill** (an order can produce many rows; sample: 58 fills across 11 symbols, NSE + BSE).
- `isin` present on every row → instrument resolution is direct; `trade_id` + exchange is the **dedupe key**; `order_id` groups fills.
- `order_execution_time` is a full timestamp (`YYYY-MM-DDTHH:MM:SS`, exchange-local/IST); `trade_date` is the date.
- `trade_type` ∈ `buy`/`sell`; `auction` boolean; `series` (EQ: `A`, `EQ`, …).
- **No charges columns.** Charges live in the ledger / P&L / AGTS (and per-trade only in contract notes). ⇒ `raw_trades.charges` is nullable; charge attribution happens at day/settlement level from ledger lines, cross-checked against the P&L statement's charge totals.

### 2. Ledger (CSV) — the fund-flow ground truth

Header: `particulars, posting_date, cost_center, voucher_type, debit, credit, net_balance`

- First row `Opening Balance` and last row `Closing Balance` (no dates) — parsers treat them as balance anchors, not transactions. `net_balance` is a running balance → **the ledger-balance reproduction gate is directly implementable**.
- `voucher_type` does most of the classification work (sample distribution over 72 rows):
  | voucher_type | narration patterns seen | classification |
  |---|---|---|
  | `Bank Receipts` | "Funds added using UPI/…" | **external_deposit** |
  | `Bank Payments` | "Payout of …", "Instant Payout of …", "Funds transferred back as part of quarterly settlement…", "Funds auto-settled to the primary…" | **external_withdrawal** (payouts) — note quarterly-settlement rows are broker-forced payouts, still real money-to-bank |
  | `Book Voucher` | "Net settlement for Equity with settlement number: …" | **internal** (trade settlement — money moved against trades, not in/out of the account) |
  | `Journal Entry` | "DP Charges for Sale of <SYM> on <date>", "AMC for Demat Account for <period>" | **charge** |
- `cost_center` (e.g. `NSE-EQ - Z`) segments the ledger by exchange/product.
- Narrations embed useful structure: payout narrations include bank name/account and a reference number; DP-charge narrations name the symbol and date. The classification rule engine gets high confidence from `voucher_type` alone; narration regexes add detail (reference ids for dedupe, symbol attribution for DP charges).

### 3. Dividend statement (XLSX, per FY) — `dividend_expectations` cross-check

Sheet `Equity Dividends`; header: `Symbol | ISIN | Ex-Date | Quantity | Dividend Per Share | Net Dividend Amount`, then a `Total Dividend Amount` row and this footer (verbatim):

> "Dividends are credited to your registered bank account within 30–45 days from the ex-date."

- **This confirms the core design decision on ticket #3**: dividends never touch the broker ledger; Zerodha itself computes *expected* dividends from record-date holdings — exactly what Kosh's `dividend_expectations` does from public feeds. This file is a second, broker-computed source to reconcile against (and a bootstrap for receipt-tracking backfill).
- "Net" amount suggests post-TDS where applicable — the receipt-confirmation flow should let actual received amounts differ from expected.

### 4. P&L statement (XLSX) — validation cross-check, not a ledger source

Sheets: `Equity` (+ `Other Debits and Credits`).

- `Equity`: Summary block (Charges, Other Credit & Debit, Realized P&L, Unrealized P&L), then a **Charges breakdown**: `Brokerage - Z`, `Exchange Transaction Charges`, `Clearing Charges - Z`, `Central GST - Z`, `State GST - Z`, `Integrated GST - Z`, `Securities Transaction Tax`, `Stamp Duty - Z`, `SEBI Turnover Fees - Z`, `IPFT` — this is the authoritative charge-type taxonomy for `trade_charge_units.charge_type` (add `ipft` and `clearing` to the enum draft), then a per-symbol P&L table.
- `Other Debits and Credits`: `Particulars | Posting Date | Debit | Credit` — AMC and DP charges; overlaps the ledger's Journal Entries → cross-check, not double-import. **Kosh imports charges from the ledger; the P&L statement validates totals** (plausibility tier: Σ ledger charges per FY ≈ P&L "Charges" summary).
- Realized/Unrealized P&L figures are trade-date-based broker numbers — useful only as a reconciliation reference, never as Kosh's own return math.

### 5. Annual Global Transaction Statement / AGTS (XLSX, per FY)

Sheets: `Equity`, `Mutual Funds`, `F&O`, `Currency`, `Commodity`. Each: Client block → **Charges** (`Account Head | Amount`, same taxonomy as P&L) → per-symbol aggregate table `Symbol | Exchange | Segment | Buy Quantity | Buy Value | Sell Quantity | Sell Value`.

- Annual aggregates only — no transaction granularity. Role in Kosh: **coverage check** for full backfill (per-FY buy/sell totals from imported tradebooks must match AGTS aggregates; mismatch ⇒ a missing tradebook chunk) and a second source for FY charge totals.
- Confirms the account's non-equity segments at a glance (empty MF/F&O/Currency/Commodity sheets here).

### Adapter plan for M1 (Zerodha)

| Export | Feeds | Priority |
|---|---|---|
| Tradebook CSV | `raw_trades` | must-have |
| Ledger CSV | `raw_ledger_lines` → `cash_flows` | must-have |
| Holdings export | `raw_holdings_snapshots` (reconciliation) | must-have (sample still pending) |
| Dividend XLSX | dividend expectation cross-check / backfill | should-have |
| P&L XLSX | charge-total plausibility checks | should-have |
| AGTS XLSX | backfill coverage check | nice-to-have |

Open items: holdings-export sample (not yet provided); how far back Console serves each export and in what chunking (owner reports FY-wise files); contract-note PDFs (deferred — tradebook+ledger suffice for v1 math).

## Groww — pending samples

## Dhan — pending samples
