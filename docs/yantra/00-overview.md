# Yantra — Autonomous Code Factory: Master Spec (v1.0)

> **Yantra** (यन्त्र): machine, instrument, loop-device. A self-hosted autonomous engineering
> factory that plans, builds, verifies, and ships — starting with its own codebase as its
> first and only project (tenant-zero).
>
> This spec supersedes nothing and implements the "Autonomous Code Factory — Final Plan
> (v2.2)" for Phase 1 reality. Where this document and the v2.2 plan disagree, this
> document wins (it encodes decisions made after the plan was written).

---

## 1. Locked decisions (do not re-litigate; change only via a `.brain/decisions.md` entry)

| # | Decision | Value |
|---|---|---|
| D1 | Name | **Yantra** |
| D2 | Home | **New private repo `yantra`**, owned by Balkrishna Agarwal's personal GitHub account. Bootstrapped as a full copy of `shipmyapp/connected-repo`. License replaced (see D15). |
| D3 | Engine | **Claude Code headless (`claude -p`) inside Docker containers**, launched by the Yantra harness on the VPS. NOT OpenHands (deferred to Phase 4 evaluation), NOT Agent of Empires (that is the cockpit, see D4). |
| D4 | Cockpit | **Agent of Empires (AoE)** installed on the VPS for human monitoring/intervention of live agent sessions (TUI + mobile web dashboard). It never drives the loop. |
| D5 | Runtime host | Existing dedicated VPS (4 vCPU / 24 GB / 200 GB), **Dokploy**, nothing else runs on it. |
| D6 | Harness home | Bootstrap harness = scripts on the VPS (Phase 0). Durable harness = **`apps/yantra`** workspace inside the monorepo (Phase 2), reusing pg-tbus, Orchid ORM, oRPC, OTEL. |
| D7 | Grade gate | CI green + model-graded rubric on every PR. **T0 auto-merges from day 1** under the rails in §6 of `loop-protocol.md`. Everything T1+ requires human merge. |
| D8 | Tracker | GitHub Issues (template-enforced Product Specs) + GitHub Projects board. Column `Agent: ready` is the intake lane. |
| D9 | Memory | `.brain/` folder in-repo (project brain) + private **`yantra-skills`** repo (portable craft). All durable writes via PR only. |
| D10 | Model lanes | Phase 0–2: **Claude Max only** (opus for advise/grade, sonnet for T0/T1 execute + dream). Phase 3: add free lanes (Gemini AI Studio, Groq, NVIDIA NIM — NIM key already in hand) via an OpenCode runner container. Antigravity: parked (IDE, not headless). |
| D11 | Spend cap | **≤ $25/month** discretionary, hard. Optimize free + existing subs first. |
| D12 | Users | Solo operator (Balkrishna) in Phase 0–3. Interface = GitHub + AoE + Novu notifications. No product UI until Phase 4. |
| D13 | Review budget | 1–2 h/day, two windows. Loop queues ≤ 20 PRs/day for human review. |
| D14 | Notifications | **Novu** (already wired in the codebase, workflows-as-code). "Needs-you" = push + email. **No quiet hours.** |
| D15 | License | connected-repo is AGPL-3.0-only (author owns copyright, relicensing is his right). The `yantra` repo starts **private, "All Rights Reserved"** placeholder; final license = open decision `OD-1`. |
| D16 | Offline infra | OneQ journal *domain* is stripped; the **online-first-with-offline-fallback infra stays** (Dexie, service worker, FCM silent sync, DataWorker/MediaWorker, sync engine). |
| D17 | GitHub auth | Week 1: fine-grained PAT for a dedicated machine user (`yantra-bot` recommended; owner's PAT acceptable day 1). GitHub App with JIT installation tokens = Phase 2 task Y2.8. |
| D18 | Concurrency | Max **3 parallel execute containers**, 4 GB RAM cap each, 2 CPU cap each. |
| D19 | Deadline | Phase 0 (loop live, first auto-merged PR) — **by tomorrow morning.** |

Open decisions (tracked, not blocking): **OD-1** final license · **OD-2** OpenRouter $10 unlock (fits D11; decide in Phase 3) · **OD-3** OpenHands adoption (Phase 4 spike Y4.6 decides).

---

## 2. The loop (the only control structure in this system)

Every unit of work — from a one-line typo fix to a whole phase — runs the same four-role loop:

```
        ┌────────────────────────────────────────────────┐
        │                                                │
        ▼                                                │
   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
   │ EXECUTE │───▶│ ADVISE* │───▶│  GRADE  │───▶│  DREAM  │
   └─────────┘    └─────────┘    └─────────┘    └─────────┘
   do the work    check the      pass/fail vs   inspect, learn,
   in a sandbox   direction      the rubric     write to memory
```

\* In practice ADVISE runs **before** EXECUTE (it gates the plan) — the conceptual order
above is the user-facing story; the wire order per turn is:
**claim → ADVISE(plan) → EXECUTE(build) → GRADE(verdict) → DREAM(record)**.
Full state machine, prompts, labels, and rails: `loop-protocol.md`.

Role → model mapping (Phase 0–2, all via Claude Max):

| Role | Model | Why |
|---|---|---|
| Advise | opus | judgment is the point; cheap in tokens (reads spec + plan, not code) |
| Execute (T2/T3) | opus | hard multi-file work |
| Execute (T0/T1) | sonnet | mechanical work; preserves Max quota |
| Grade | opus | the gate must be the smartest thing in the loop |
| Dream | sonnet | summarization + telemetry, batched nightly |

Cadence decisions (locked): Advise = pre-execution plan gate only (no mid-turn checkpoint
in Phase 0–2). Dream = per-turn micro-write (telemetry row + candidate lesson to
`.brain/inbox/`) + **nightly consolidation run** that opens the actual `.brain/` and
skills PRs.

---

## 3. Phase map

Phases are defined by **parallelism boundaries**: a phase = the largest set of tasks that
can run concurrently once the previous phase's exit criteria hold. Within each phase,
tasks are grouped into parallel groups (A, B, C…); tasks in the same group are
independent of each other; groups may have declared dependencies.

| Phase | File | Goal | Executor | Exit test |
|---|---|---|---|---|
| **0 — Live by morning** | `01-phase-0-live-by-morning.md` | Bootstrap loop v0 running on the VPS; first T0 PR auto-merged untouched | Human + Claude session, pair-run tonight | `P0-EXIT` checklist all green |
| **1 — Calibration** | `02-phase-1-calibration.md` | Loop proves itself on mechanical work: full CI, strip OneQ, seed brain + skills | **The loop** (seeded backlog) | ≥ 12 merged loop PRs, ≥ 70% first-try grade pass, 0 unreverted regressions |
| **2 — Durable harness** | `03-phase-2-harness.md` | Port loop v0 → `apps/yantra` (pg-tbus, Orchid state, Novu, nightly dream, AoE cockpit) | The loop, human merges | v1 harness passes parity suite; v0 scripts retired |
| **3 — Lanes + learned routing** | `04-phase-3-lanes-telemetry.md` | Free lanes live (Gemini/Groq/NIM), scorecards, routing table data-driven, spend ledger | The loop | 2+ free lanes doing real T0/T1 work; scorecard dashboard; spend ≤ $25 |
| **4 — Expansion** | `05-phase-4-expansion.md` | Event feed + cockpit UI, Flutter project onboarding, OpenHands spike, exploration mode | The loop | Second project (Flutter app) onboarded end-to-end |

Phase 1 exit was originally "10 working days"; per D19 the calendar is compressed:
Phase 0 tonight, Phase 1 target ≤ 4 days, but exit criteria are **evidence-based, not
calendar-based** — the loop advances when the numbers hold, not when the date arrives.

---

## 4. Repository layout after Phase 0

```
yantra/                          # the new repo (copy of connected-repo)
├── .github/
│   ├── workflows/ci.yml         # Y0.5 minimal CI → Y1.A full CI
│   └── ISSUE_TEMPLATE/product-spec.yml
├── .brain/                      # project brain (Y0.6 skeleton, Y1.C seeded)
│   ├── decisions.md             # append-only decision log (D1… + new)
│   ├── conventions.md           # how we ship here
│   ├── negative-knowledge.md    # tried-and-rejected, with reasons
│   └── inbox/                   # dream's per-turn candidate lessons (pre-curation)
├── apps/
│   ├── backend/                 # existing oRPC server (OneQ stripped in Phase 1)
│   ├── frontend/                # existing React app (OneQ stripped in Phase 1)
│   └── yantra/                  # Phase 2: the durable harness
├── docs/yantra/                 # THIS SPEC (copied from connected-repo)
├── ops/yantra/                  # Phase 0 bootstrap scripts (v0 loop) — retired in Phase 2
└── packages/…                   # existing shared packages
```

The `yantra-skills` repo (separate, private): `skills/<stack-tag>/<skill-name>.md`,
seeded in Y1.C from external collections (mattpocock/skills, addyosmani/agent-skills,
Forward Future loop-library), every entry via PR.

---

## 5. Glossary

- **Turn** — one full claim→advise→execute→grade→dream cycle on one issue.
- **Run** — one container invocation of one role (an execute run, a grade run…).
- **Tier (T0–T3)** — risk class of a change, assigned by Advise, verified by Grade.
  T0 mechanical · T1 low-risk code · T2 feature/multi-file · T3 sensitive
  (auth, secrets, CI, harness itself, `.brain/` promotions).
- **Product Spec** — the intake artifact (issue): Problem / Bet / Success criteria /
  Evaluation. Success criteria ARE the grade rubric's spec-fit section.
- **Kill switch** — repo Actions variable `YANTRA_KILL`. `"true"` ⇒ harness exits
  before claiming, merging, or spawning anything. Checked at every state transition.
- **Rails** — the hard limits around auto-merge (loop-protocol.md §6).
- **needs-human** — label + Novu push; the loop parks the issue and moves on.

## 6. Reading order for a fresh contributor (human or model)

1. This file. 2. `loop-protocol.md` (the machine). 3. `rubrics.md` (the gate).
4. The current phase file. 5. `.brain/conventions.md` + `.brain/decisions.md`.
6. `templates/product-spec.md` before writing any new issue.
