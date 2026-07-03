# Seed Backlog (file these as issues in Y0.7)

SB-1 is written out in full — it is tonight's smoke test and the reference-quality
example of a filed Product Spec. The rest are the Phase 1/2 tasks from the phase files;
file each with the issue form, copying its success criteria from the phase file and
adding the frontmatter shown in the table. `depends-on` uses the real issue numbers
GitHub assigns — file in table order so the numbers line up predictably.

---

## SB-1 — Fix the three stale README claims (tonight's smoke test)

```markdown
---
type: docs
stack: docs
tier-estimate: T0
depends-on: —
parallel-group: 0.smoke
---

## Problem
README misstates the stack in three places, which poisons every agent that reads it as
ground truth: (1) says notifications are "SuprSend" — the code uses Novu
(apps/backend/src/novu/); (2) implies GitHub Actions CI exists and is complete — the
workflow was only added tonight (Y0.4) and covers build/lint/types/tests only; (3) the
Tech Stack section omits the task queue's schema name and misleads about realtime
(it's offline-first FCM silent-sync, not live push).

## Bet
If we correct these three claims, the next agent that greps README for "SuprSend" or
"realtime" gets truth, verifiable by the greps below.

## Success criteria
- [ ] `grep -i suprsend README.md` → 0 hits; Novu named instead, pointing at
      `apps/backend/src/novu/`.
- [ ] CI section describes exactly the jobs in `.github/workflows/ci.yml`, no more.
- [ ] Realtime description says "offline-first delta sync via FCM silent push +
      service worker" (one sentence, links `apps/backend/src/modules/sync/`).
- [ ] Diff touches ONLY README.md, ≤ 60 changed lines.
- [ ] `yarn lint && yarn check-types && yarn test:run` green in CI.

## Out of scope
Full README rewrite (Phase 1), AGENTS.md (task C5), any code change.

## Evaluation
Post-merge canary CI green. Revert condition: none plausible (docs-only).

## Context & pointers
README.md · apps/backend/src/novu/workflows/ · docs/yantra/00-overview.md D14/D16.
```

## SB-2 — Kill-switch drill target (throwaway T0)

Same shape as SB-1: "Add a `docs/yantra/OPERATORS.md` one-liner file linking DAILY.md."
Purpose: sits in `Agent: ready` during the Y0.8 kill-switch drill to prove the loop
does NOT touch it while killed; afterwards it runs as a second normal T0 rep.

## Phase 1 filings (order = filing order)

| File as | From phase file | tier | depends-on | group |
|---|---|---|---|---|
| SB-3 Coverage gate | 1.A A1 | T1 | — | 1.A |
| SB-4 knip in CI | 1.A A2 | T1 | — | 1.A |
| SB-5 Playwright E2E job | 1.A A3 | T2 | SB-3 | 1.A |
| SB-6 PR template | 1.A A4 | T0 | — | 1.A |
| SB-7 Branch protection tightening | 1.A A5 | T3 | SB-3, SB-4, SB-5 | 1.A |
| SB-8 Strip backend journal_entries | 1.B B1 | T1 | SB-3 | 1.B |
| SB-9 Strip backend prompts module | 1.B B2 | T1 | SB-8 | 1.B |
| SB-10 Strip journal events + Novu workflow | 1.B B3 | T1 | SB-9 | 1.B |
| SB-11 Strip frontend journal pages/routes | 1.B B4 | T1 | SB-3 | 1.B |
| SB-12 Strip frontend stores/worker refs | 1.B B5 | T1 | SB-11 | 1.B |
| SB-13 Strip zod-schemas journal schemas | 1.B B6 | T1 | SB-10, SB-12 | 1.B |
| SB-14 Migrations dropping OneQ tables | 1.B B7 | T2 | SB-13 | 1.B |
| SB-15 Seeds/fixtures cleanup + B9 verification greps | 1.B B8+B9 | T1 | SB-14 | 1.B |
| SB-16 `.brain/` skeleton + D1–D19 | 1.C C1 | T1 | — | 1.C |
| SB-17 yantra-skills bootstrap (human creates repo first) | 1.C C2 | T1 | — | 1.C |
| SB-18 Seed 8–12 external skills | 1.C C3 | T1 | SB-17 | 1.C |
| SB-19 Skill-matching in prompts | 1.C C4 | T3 | SB-16, SB-18 | 1.C |
| SB-20 AGENTS.md refresh | 1.C C5 | T1 | SB-16 | 1.C |
| SB-21 AoE install + ops doc | 1.D D1 | T1 | — | 1.D |
| SB-22 Novu yantra workflows | 1.D D2 | T2 | — | 1.D |
| SB-23 DAILY.md ops one-pager | 1.D D3 | T1 | SB-21, SB-22 | 1.D |

Phase 2+ tasks get filed by the nightly planner run once Phase 1's exit numbers hold —
do not pre-file them; the DAG stays short enough to reprioritize by dragging.

## Filing rules

- One issue = one PR = one turn. If a filing feels like it needs two PRs, split it
  before filing (that's what the B-chain does).
- Success criteria must be copy-pasted commands/greps wherever possible — the grader
  runs on evidence, and evidence means executable checks.
- After filing: move SB-1 (only) to `Agent: ready`. The rest advance per Y0.8's final
  step and thereafter whenever their `depends-on` closes (harness checks deps at claim).
