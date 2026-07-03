# Phase 1 — Calibration (the loop's first real work)

**Goal:** the loop proves itself on mechanical, unambiguous work while building its own
foundations: full CI, OneQ stripped (infra preserved — D16), brain + skills seeded.
**Executor:** the loop. Human role: two review windows/day, merge T1+, answer
needs-human parks.
**Entry:** P0-EXIT green. **Target:** ≤ 4 days.

**Exit criteria (evidence-based):**
- ≥ 12 loop-authored PRs merged; ≥ 70% passed grade first-try; 0 unreverted regressions
  on main; every OneQ acceptance grep (below) clean; `.brain/` + `yantra-skills` seeded
  and receiving nightly dream PRs; operator time ≤ 2 h/day.

Parallel groups: **A ∥ B ∥ C ∥ D** (fully independent of each other once their listed
deps close). Within B, tasks are sequenced by dependency arrows. Each task below is
filed as a Product Spec issue (see `06-seed-backlog.md` for the filed versions).

---

## Group 1.A — CI hardening (deps: none) — tiers T1–T3

| ID | Task | Tier | Success criteria (abbrev — full spec in backlog) |
|---|---|---|---|
| A1 | Coverage gate | T1 | vitest coverage in CI; thresholds = current baseline − 0 (ratchet file committed); red if drops |
| A2 | knip in CI | T1 | `yarn knip` as a check; current findings triaged into the backlog, not silenced |
| A3 | Playwright E2E job | T2 | frontend E2E headless against preview build; flake-retry ≤ 1; artifacts on failure |
| A4 | PR template | T0 | `.github/pull_request_template.md` mirroring execute's required PR body |
| A5 | Branch protection tightening | **T3** | required checks list = {checks, tests, e2e, coverage}; humans-only merge for T1+ enforced via CODEOWNERS on protected paths (rails §6 R2 list) |

## Group 1.B — Strip OneQ, keep the infra (deps: A-group CI must be green first ⇒ `depends-on: A1`) — the calibration meat

Sequenced (each PR small, independently green — this is deliberate loop training data):

```
B1 backend journal_entries module  ──▶ B2 prompts module ──▶ B3 backend events/novu
B4 frontend journal pages/routes   ──▶ B5 frontend stores/workers refs
B6 zod-schemas journal schemas (after B3 + B5)
B7 DB migrations dropping OneQ tables (after B6)
B8 seeds/fixtures cleanup (after B7)
```
(B1→B3 chain ∥ B4→B5 chain, converging at B6.)

**Hard invariant for every B task (D16):** nothing under `modules/sync/`,
`sw/`, `worker/`, Dexie schemas' infra layer, FCM plumbing changes. Grade FAILs any B
PR touching those paths regardless of other scores.

**Phase-level acceptance (checked by B9, a T0 verification task):**
`grep -ri "journal\|oneq\|streak" apps packages --include="*.ts" --include="*.tsx" | grep -v docs/` → 0 hits;
fresh-DB `yarn db create && yarn db up && yarn test:db:setup && yarn test:run` green;
sync-engine test suite untouched and green.

## Group 1.C — Brain + skills seeding (deps: none) — tiers T1/T3

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| C1 | `.brain/` skeleton | T1 | four files per overview §4; `decisions.md` pre-loaded with D1–D19 + OD-1..3; conventions distilled from AGENTS.md (not copied — distilled, ≤ 150 lines) |
| C2 | `yantra-skills` repo bootstrap | T1 | repo created (human creates, loop PRs content); layout `skills/<stack>/<name>.md`; each skill: frontmatter (stack tags, source, proven-count), body ≤ 80 lines |
| C3 | Seed 8–12 skills from external collections | T1 | curated from mattpocock/skills, addyosmani/agent-skills, FF loop-library; each rewritten to Yantra's format, source-linked; no verbatim dumps |
| C4 | Wire skill-matching into advise/execute prompts | **T3** | prompts read `stack:` tags → include matching skill bodies; prompt-version bumped; A/B note in telemetry (`prompt_version` field already exists) |
| C5 | `AGENTS.md` refresh | T1 | stale OneQ references gone; points agents at `.brain/` + this spec |

## Group 1.D — Operator surface (deps: none) — tiers T1/T2

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| D1 | AoE on the VPS | T1 (ops doc PR + human install) | AoE running; loop's tmux/exec sessions visible; you can attach from phone; documented in `ops/yantra/README.md` |
| D2 | `yantra-needs-you` + `yantra-digest` Novu workflows | T2 | workflows-as-code in the repo's existing `novu/workflows/` pattern; needs-human → instant push+email; digest → 2×/day batch (no quiet hours — D14); `notify.sh` switched to them |
| D3 | Daily ops one-pager | T1 | `ops/yantra/DAILY.md`: the 10-minute morning checklist (telemetry tail, parked issues, kill-switch state, disk/RAM) |

## Dream focus this phase

Nightly dream is explicitly prompted (prompt-version bump, T3 via C4's PR) to look for:
claim/label race bugs, grade verdicts you overturned (false PASS/FAIL — log each as a
`rubrics.md` candidate fix), specs that parked AMBIGUOUS (what field was missing →
improve the issue template), and time-sinks (which task_type runs longest — feeds
Phase 3 routing).

## Test cases for the phase itself (run by a T0 verification task at exit, B9-style)

1. Pick 3 random merged loop PRs → each has: claim comment, advise JSON, grade JSON
   with evidence, telemetry line. (Audit-trail completeness.)
2. `YANTRA_KILL` drill again under load (3 working issues) → all three park cleanly at
   their next transition, nothing merges.
3. Deliberately file a poisoned spec (criterion impossible: "delete file X and keep
   file X") → advise parks AMBIGUOUS, not execute-then-fail. (Plan-gate quality.)
4. Deliberately open a hand-written PR weakening a test (`.skip`) with `tier:T0` label
   → grade FAILs on tests=0 regardless of green CI. (Gate can't be gamed by labels.)
5. Operator time log for the last 2 days ≤ 2 h/day (honest self-report).
