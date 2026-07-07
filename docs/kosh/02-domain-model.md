# Kosh — Domain Model (draft)

Status: **DRAFT** — implementable now for M1–M3 of the [roadmap](./05-roadmap.md); fields marked ⚠ depend on open grillings. Conventions: Orchid ORM on Postgres; snake_case columns in SQL (ADR-002); **all money as `NUMERIC` (never float)**; quantities `NUMERIC(20,8)`; money `NUMERIC(20,2)` (crypto cash `NUMERIC(30,10)`); all timestamps `timestamptz` (UTC); soft supersession, no deletes, on Layer-1/2 tables.

Model lineage: transaction/unit design adapted from Portfolio Performance (see [prior-art](../research/prior-art.md) §3); everything else per the three-layer architecture ([01-architecture.md](./01-architecture.md) §3).

## 1. People, accounts, groups

```
persons                     -- family members as portfolio subjects (not logins)
  id, family_id (→teams ⚠ pending grilling #2), display_name, created_at

broker_accounts
  id, family_id, person_id →persons, broker enum('zerodha','dhan','groww','manual', ...),
  label, base_currency char(3) default 'INR',
  connection_method enum('file_drop','api')  -- 'api' reserved for later phase
  opened_at date?, closed_at date?, created_at

account_groups              -- saved, ad-hoc, overlapping selections
  id, family_id, name, created_at
account_group_members
  group_id →account_groups, account_id →broker_accounts, PK(group_id, account_id)
```

Invariants: an account belongs to exactly one person; groups are arbitrary subsets (an account may be in many groups); "whole family" is a virtual group (all accounts), not a row.

## 2. Layer 1 — raw imports

```
import_batches
  id, family_id, account_id →broker_accounts, kind enum('tradebook','ledger','holdings',
    'contract_note','cas','manual_entry'),
  file_id →files?,                  -- verbatim upload (null for manual entry)
  source_tool text?,                -- e.g. 'casparser 1.3.0' for CAS JSON
  status enum('parsing','validating','preview','applied','rejected','retracted'),
  content_sha256, uploaded_by →users, applied_at?, superseded_by_batch_id?,
  retraction_event_id →events?,     -- set when retracted
  stats jsonb                       -- row counts, date span, dedupe summary

raw_trades                          -- exactly as broker reported; NEVER adjusted
  id, batch_id →import_batches, account_id, trade_date date, exec_time timestamptz?,
  broker_symbol text, exchange enum('NSE','BSE','other')?, isin text?,
  side enum('buy','sell'), quantity NUMERIC(20,8), price NUMERIC(20,4),
  broker_trade_id text?, broker_order_id text?,
  charges jsonb,                    -- {brokerage, stt, gst, stamp_duty, exchange_txn, sebi, other} as reported
  raw_row jsonb                     -- the full original row for audit
  UNIQUE(account_id, broker_trade_id) WHERE broker_trade_id IS NOT NULL

raw_ledger_lines                    -- funds statement lines; the fund-flow source
  id, batch_id, account_id, posted_date date, value_date date?,
  narration text, debit NUMERIC(20,2)?, credit NUMERIC(20,2)?, running_balance NUMERIC(20,2)?,
  broker_voucher_id text?, raw_row jsonb

raw_holdings_snapshots              -- broker-reported holdings on a date; used for reconciliation
  id, batch_id, account_id, as_of date, isin?, broker_symbol, quantity, avg_price?, raw_row jsonb

provider_payloads                   -- every market-data / feed pull, verbatim
  id, source enum('nse_bhavcopy','bse_bhavcopy','amfi_nav','nifty_tri','ibja_gold','fx',
    'nse_corp_actions','bse_corp_actions', ...),
  fetched_at, url text, payload_sha256, file_id →files, status
```

Dedupe keys (validation gate): `broker_trade_id` where present; else content hash of normalized `(account, date, symbol, side, qty, price)`. Overlapping re-uploads are detected row-wise and marked duplicates in preview.

## 3. Layer 2 — instruments & identity

```
instruments                         -- one row per economic asset, across name/symbol changes
  id, kind enum('equity','etf','mf','bond','sgb','reit_invit','crypto','fx_pair','index','commodity'),
  isin text? UNIQUE,                -- equities/ETFs/MF/bonds; null for crypto/index
  symbol_canonical text,            -- current primary symbol (or coin ticker / index name)
  name text, currency char(3),      -- quote currency (INR; USD for US stocks; etc.)
  exchange_calendar text?,          -- 'NSE', 'NYSE', '24x7' (crypto)
  amfi_code text?, created_at

instrument_aliases                  -- time-ranged symbol/name identities (renames)
  id, instrument_id, alias text, alias_kind enum('nse_symbol','bse_code','broker_symbol','name','old_isin'),
  broker enum?, valid_from date?, valid_to date?
  -- resolution: broker_symbol+broker → alias → instrument; ISIN wins over everything

instrument_links                    -- identity continuity across corporate events
  id, from_instrument_id, to_instrument_id,
  link_kind enum('isin_change','merger_into','demerged_from','rename'),
  event_id →corporate_action_events, effective_date
```

## 4. Layer 2 — the event log

```
events                              -- the append-only spine; every L2 fact is an event
  id, family_id, kind enum(
    'trade_recognized',             -- raw trade admitted into the ledger
    'cash_flow_classified',         -- ledger line → external deposit/withdrawal/internal/charge
    'corporate_action_applied',     -- CA applied to an account
    'dividend_expected', 'dividend_receipt_confirmed',
    'fee_schedule_set', 'fee_charged',
    'user_resolution',              -- an answer to a prompt
    'retraction'),                  -- supersedes another event
  payload jsonb, actor enum('system','user'), user_id?,
  occurred_at,                      -- domain time (e.g. ex-date)
  recorded_at default now(),
  retracts_event_id →events?,       -- set iff kind='retraction'
  superseded_by_event_id →events?   -- set on the TARGET when retracted; live = IS NULL
  reason text?                      -- mandatory for retractions

corporate_action_events             -- market-level facts (not per-account)
  id, instrument_id, action_type enum('split','bonus','dividend','merger','demerger',
    'rights','buyback','symbol_change','isin_change','delisting'),
  ex_date date, record_date date?, pay_date date?,
  ratio_old int?, ratio_new int?,             -- split/bonus/rights: old:new semantics documented per type
  amount_per_share NUMERIC(20,4)?,            -- dividends, buyback price
  cost_apportionment NUMERIC(9,6)?,           -- demergers: fraction of cost to spun-off entity
  counterpart_instrument_id?,                 -- merger target / demerged child
  source enum('nse_feed','bse_feed','user','import_inference'), source_payload_id →provider_payloads?,
  raw_purpose_text text?,                     -- the free text the ratio was parsed from
  parse_confidence enum('high','low','manual'),
  status enum('pending_validation','active','quarantined','superseded'), superseded_by_event_id?

corporate_action_applications        -- per-account application state
  id, corporate_action_event_id, account_id,
  state enum('auto_applied','needs_input','user_resolved','revoked'),
  applied_event_id →events?, resolution_event_id →events?,
  effect jsonb                       -- before/after preview (qty, cost basis) for UI + audit
```

## 5. Layer 2 — the ledger (ground truth for returns)

```
trades                               -- validated, instrument-resolved view of raw_trades (1:1, immutable)
  id, raw_trade_id →raw_trades UNIQUE, account_id, instrument_id, trade_date, side,
  quantity, price, gross_value, total_charges,      -- Σ charge_units
  net_value,                                        -- buy: gross+charges; sell: gross−charges
  recognized_event_id →events

trade_charge_units                   -- itemized, Portfolio-Performance-style units
  id, trade_id, charge_type enum('brokerage','stt','gst','stamp_duty','exchange_txn','sebi_fee',
    'dp_charge','other'),
  amount NUMERIC(20,2), currency char(3),
  forex_amount NUMERIC(20,4)?, exchange_rate NUMERIC(20,8)?   -- for foreign-currency trades ⚠ #15
  -- invariant (checked): forex_amount × exchange_rate ≈ amount within tolerance

cash_flows                           -- THE fund-flow table; XIRR reads exactly this
  id, account_id, flow_date date, amount NUMERIC(20,2),       -- signed: +into account, −out
  currency char(3),
  classification enum(
    'external_deposit','external_withdrawal',     -- the flows that define true returns
    'internal_transfer',                          -- inter-family; nets out at group level
    'dividend_receipt',                           -- synthetic inflow+outflow pair OR real credit ⚠ semantics per #3
    'fee_external',                               -- fund-manager fee paid outside the account
    'charge','interest','other_internal'),
  transfer_pair_id →cash_flows?,                  -- links the two legs of an internal transfer
  source_ledger_line_id →raw_ledger_lines?, classified_event_id →events,
  inr_amount NUMERIC(20,2), fx_rate_used NUMERIC(20,8)?       -- INR view fixed at classification time ⚠ #15

dividend_expectations                -- generated: holdings on record_date × amount_per_share
  id, corporate_action_event_id, account_id, expected_amount, record_date_quantity,
  status enum('expected','confirmed','not_received','waived'),
  receipt_date date?, receipt_txn_id text?, receipt_amount?,   -- user-entered
  confirmed_event_id →events?
  -- return calc uses receipt_date if confirmed else pay_date (owner decision)

fee_schedules                        -- fund-manager fees ⚠ exact shapes pending #5
  id, family_id, scope ('account'|'group'), account_id?/group_id?,
  model enum('pct_aum_pa','fixed','profit_share','invoiced'), params jsonb,
  valid_from, valid_to?, set_event_id →events
```

**Key invariants**
- `cash_flows` with `classification IN ('external_deposit','external_withdrawal')` are the *only* inputs to money-weighted returns; a `default: throw`-style exhaustive switch in `finance-math` forces every new classification to be explicitly internal or external (Portfolio Performance's pattern).
- Internal transfers must be paired; unpaired candidates (matching amounts, ≤3 days apart, opposite signs, different family accounts) surface as prompts.
- Every ledger row traces to a raw row (`source_ledger_line_id` / `raw_trade_id`) and an event.

## 6. Layer 2 — market data reference

```
price_bars                            -- raw as-published bars; adjustments are NOT baked in
  instrument_id, resolution enum('1s','1m','1h','1d'), ts timestamptz,   -- UTC
  open NUMERIC(20,6), high, low, close, volume NUMERIC(24,2)?,
  source enum, payload_id →provider_payloads,
  PK(instrument_id, resolution, ts)
  -- v1 populates '1d' only; schema admits finer resolutions without migration (owner decision)

exchange_calendars
  calendar text, date date, is_trading_day bool, close_time_local time, tz text

fx_rates
  base char(3), quote char(3), rate_date date, rate NUMERIC(20,8), source, payload_id
  PK(base, quote, rate_date)          -- direct pairs stored; INR legs mandatory ⚠ source per #15

adjustment_factors                    -- derived from corporate_action_events (Layer 3, materialized)
  instrument_id, effective_ex_date, qty_factor NUMERIC(20,10), price_factor NUMERIC(20,10),
  cumulative_qty_factor, cumulative_price_factor, source_event_id
  -- adjusted series = raw bars × cumulative factors, computed at read time or materialized per version
```

## 7. Layer 3 — derived (all rebuildable; every table carries `ledger_version`)

```
ledger_versions                       -- monotonically increasing; bumped by any L1/L2 change per family
  family_id, version bigint, cause_event_id, created_at

positions_daily                       -- per account × instrument × date: qty (raw + adjusted), cost basis (FIFO lots in lots table)
lots                                  -- FIFO lots: open qty, cost, source trade; consumed-by links
valuation_snapshots                   -- per account × date: securities value + ledger cash = account value (INR + native)
metric_results                        -- cache: (account_set_hash, from, to, metric, params_hash, ledger_version) → value + trail_id
shadow_portfolio_snapshots            -- per benchmark × account_set × date: replayed value series
reconciliation_diffs                  -- expected holdings (from ledger+events) vs raw_holdings_snapshots; drives prompts
trails                                -- the "explain this number" payloads: ordered flow list, valuations, solver diagnostics
prompts                               -- materialized queue: unexplained holdings diffs, unpaired transfers,
                                      --  low-confidence CA parses, dividend confirmations due
```

Replay contract: `rebuild(family_id, from_date)` deterministically regenerates every Layer-3 row for that family from Layers 1+2 at the current `ledger_version`. Property test: retract-and-reapply any event ⇒ byte-identical Layer 3.

## 8. Walk-through scenarios (acceptance for this model)

The [domain-model prototype ticket](https://github.com/krishna-404/family-portfolio-tracker/issues/12) must demonstrate, end-to-end on this schema:
1. **Demerger** — parent's cost basis apportioned by `cost_apportionment`, child instrument appears via `instrument_links`, unexplained-holding prompt when the feed lacked the ratio.
2. **Internal transfer** — Dad→Son ₹5L: two paired `cash_flows`; Son's XIRR sees +5L, Dad's −5L, family-group XIRR sees nothing.
3. **Arbitrary-window XIRR** — uses `valuation_snapshots` at boundaries as pseudo-flows.
4. **Foreign holding** — USD trade with `forex/exchange_rate` units; INR return vs USD return decomposition.
5. **Wrong split retracted** — apply 1:10 in error, retract (supersede), re-apply 1:5; Layer 3 heals; audit shows the full history.
