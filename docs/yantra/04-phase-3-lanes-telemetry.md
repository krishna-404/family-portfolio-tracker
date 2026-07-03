# Phase 3 — Free Lanes + Learned Routing

**Goal:** breadth without spend. Free lanes (Gemini AI Studio, Groq, NVIDIA NIM — key
in hand) do real T0/T1 work via an OpenCode runner container; telemetry becomes
scorecards; the routing table turns data-driven. Hard cap: **≤ $25/mo** (D11).
**Executor:** the loop. **Entry:** Phase 2 exit. **Target:** ~1–2 weeks, low urgency —
this phase optimizes a working factory, it doesn't unblock one.

**Honest framing (from the source plan §4):** stacking free lanes is resilience, not
capacity magic; every free tier may train on inputs — fine for Yantra's own code (no
NDA work exists yet — D-answer 2026-07-03), but the confidentiality toggle ships in
this phase anyway (L6) so it exists before the first client repo ever onboards.

Parallel groups: **A (runner) ∥ B (scorecards)**, then **C (routing)** needs both.

---

## Group 3.A — Free-lane runner (deps: none) — T2/T3

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| L1 | `yantra-exec-oc` image: OpenCode CLI + node22 + git + gh | T2 | same in/out contract as `yantra-exec` (prompt file in, branch+PR out); provider chosen by env (`OC_PROVIDER=gemini\|groq\|nim`); NIM base `integrate.api.nvidia.com/v1` |
| L2 | Lane registry `ops/yantra/lanes.json` | T2 | per lane: endpoint, key-env-name, RPM/RPD/TPD limits (verified at write time, not hardcoded from memory), live model-list URL, enabled flag |
| L3 | Headroom tracker | T2 | per-lane token/request counters in `yantra_telemetry` rollup; lane marked `throttled` at 80% of any limit, auto-clears on window reset; router (L7) reads it |
| L4 | Key management | **T3** | keys land in `/opt/yantra/env/` + Dokploy secrets, never in repo; runner env-file per lane; secret-scan check in CI (gitleaks) |
| L5 | Lane smoke suite | T1 | nightly cron: 1-token ping per enabled lane; failures flip `enabled:false` + digest note (silent model-deletion defense) |
| L6 | Confidentiality toggle | T2 | per-repo flag in harness config; `confidential:true` ⇒ router hard-excludes all free lanes; unit test proves exclusion is unbypassable by routing-table edits (checked in `checkRails`-style pure fn) |

## Group 3.B — Scorecards (deps: none — telemetry already flows) — T1/T2

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| S1 | Rollup job: `(lane, model, task_type, tier)` → rolling 20-run window: first-try pass rate, median wall_s, retry rate, cost | T2 | materialized nightly by dream; queryable via H10 router; matches hand-computed fixture |
| S2 | Cockpit scorecard tile | T1 | H11 page shows the table, sortable; a lane with < 5 runs renders "insufficient data", never a rate |
| S3 | Spend ledger | T2 | every run's `cost_usd` (0 for subs/free) + monthly rollup; **hard stop**: projected month-spend > $25 ⇒ paid-lane runs refuse to start + needs-you push (D11 as code, not policy) |

## Group 3.C — Learned routing (deps: L*, S1) — T3

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| R1 | Router v1 | **T3** | replaces static routing.json semantics: choose lane by (task_type, tier) scorecard — best first-try pass rate, cost tiebreak, headroom filter, confidentiality filter; falls back to claude-max when insufficient data (< 5 runs) or all free lanes throttled; decision logged into the telemetry row (`router_reason` field) |
| R2 | Shadow week | T1 | for 1 week router logs its choice but v0 table still decides; divergence report in nightly dream; you approve activation (T3 human gate) |
| R3 | Canary activation | **T3** | router live for T0/T1 execute ONLY (advise/grade/dream stay claude-max permanently this phase — the gate never runs on a free model); weekly dream reviews scorecard drift |
| R4 | OD-2 decision task | T0 (doc) | with 2 weeks of scorecard data: is the $10 OpenRouter unlock (→1000 RPD across `:free` models) worth it inside the $25 cap? Written recommendation into `.brain/decisions.md` |

## Exit criteria

- ≥ 2 free lanes each with ≥ 10 completed T0/T1 execute runs; scorecards live in
  cockpit; router active for T0/T1 with fallback proven (pull a lane's key mid-run in
  staging → clean fallback, no lost turn); month spend ≤ $25 with ledger evidence;
  Max-quota consumption for T0/T1 down ≥ 50% vs Phase 2 baseline (that's the point).

## Test cases for the phase itself

1. Throttle simulation: set a lane's RPD to 3 in staging → 4th run routes elsewhere,
   telemetry shows `router_reason: "headroom"`.
2. Confidential fixture repo → every run's lane ∈ {claude-max}, asserted over 20 turns.
3. Spend guard: inject fake $26 ledger → paid-lane run refuses, push received.
4. Grade quality invariant: sample 10 free-lane PRs vs 10 Max PRs — grade pass rates
   recorded; if free-lane first-try pass < 50% of Max's for a task_type, dream files an
   issue to re-tier that task_type back to Max (the learning loop actually closing).
5. Lane roster churn: point L5 smoke at a removed model name → lane disabled + digest
   note within 24 h.
