# Phase 4 — Expansion (feed, Flutter wave, OpenHands decision, exploration)

**Goal:** the factory grows outward: a real event feed, the first external project
(a Flutter app — first wave per D-answer 2026-07-03), the OpenHands adopt/skip
decision, and bounded exploration mode.
**Entry:** Phase 3 exit. This phase's groups are fully independent — run all four
concurrently at whatever pace review budget allows.

---

## Group 4.A — Event feed + realtime (T2)

The boilerplate has no push-stream primitive (its "realtime" is offline-first FCM
silent-sync — kept per D16, but wrong shape for a live feed).

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| E1 | SSE endpoint in backend (`/api/yantra/feed`) streaming turn/verdict/merge events from pg-tbus | T2 | reconnect-safe (Last-Event-ID), auth-gated, OTEL span per stream |
| E2 | Cockpit feed pane replaces 30 s poll | T1 | live within 2 s of event; degraded-mode banner when stream drops |
| E3 | Feed→Novu dedupe | T1 | needs-you pushes suppressed when the operator has the feed open (presence ping) — no double-notification |

## Group 4.B — First Flutter project onboarding (T2/T3)

Per plan §11 (web-render verification path). Onboarding = a repeatable checklist the
loop executes, becoming the template for every later repo.

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| F1 | Onboarding runbook doc (generic, repo-agnostic) | T1 | covers: PAT/App scope add, labels+board, CI skeleton, `.brain/` init, conventions distillation, first 3 seed specs |
| F2 | Flutter CI recipe | T2 | `flutter analyze` + `flutter test` headless + `flutter drive -d web-server` in Actions; caching so PR runs < 10 min |
| F3 | Web-render verification skill | T2 | skill in yantra-skills: build Flutter web in exec container, drive with Playwright/browserless, attach screenshots to PR |
| F4 | Firebase Test Lab nightly (free quota) | T2 | real-device matrix nightly; failures open issues via the Sentry-idle-feeder pattern |
| F5 | Onboard the chosen app end-to-end | **T3** | one real Product Spec through claim→merge on the Flutter repo; multi-repo harness config proven (per-repo lanes/confidentiality/rails) |

Device-cloud (agent-device / Limrun) = deferred until F4's quota actually binds.

## Group 4.C — OpenHands evaluation spike (resolves OD-3) — T1 doc + T3 decision

Timeboxed 2 days of loop + 1 review window of yours.

| ID | Task | Success criteria |
|---|---|---|
| O1 | Stand up OpenHands on the VPS (Docker), LocalRuntime, drive ONE real backlog spec through its Resolver | it ships a PR through OUR gate (grade still ours — the gate never moves) |
| O2 | Decision memo into `.brain/decisions.md` | scored against: sandbox quality vs our docker-run, multi-repo ergonomics, free-lane driving vs our OpenCode runner, maintenance surface, Daytona path. Verdict = adopt-as-execute-backend / adopt-for-cloud-breadth-only / skip-for-now. **The loop protocol, rails, brain, and gate are ours regardless** — OpenHands is only ever a candidate execute backend. |

## Group 4.D — Exploration mode (bounded free-play) — T3 to enable

Plan §7's second mode, with all its rails intact.

| ID | Task | Tier | Success criteria |
|---|---|---|---|
| X1 | Exploration runner | **T3** | fires only when ready-lane empty AND kill switch off AND spend guard green; sandbox = scratch clone; output ONLY to a `exploration/` branch or `.brain/inbox/`; never opens PRs against protected paths; hard 2 h wall-clock cap |
| X2 | Exploration charter prompt | T1 | "improve a skill, prune inbox, replicate one relevant technique from a linked paper/repo, or profile the slowest task_type" — reviewed via the same nightly dream PR path |
| X3 | Weekly exploration digest | T0 | one section in the digest: what it tried, what it kept, tokens spent |

## Phase exit = the factory's steady state

- Feed live; Flutter repo shipping through the loop; OD-3 decided in writing;
  exploration producing ≥ 1 kept improvement/week; operator cadence: 2 review
  windows/day + 1 weekly planning hour (voice-dump → planner DAG per plan §7).

## What comes after (pointers, not commitments)

Wrapper productization (rooms/chat, multi-team, client engagement workspaces) =
plan v2.2 §6/§19 — gated on this factory running long enough that you trust its
telemetry. Marketing/beyond-code extension = plan §16 Phase 4. Multi-tenant SaaS =
plan §19, gated on the differentiation answer. None of it enters this backlog until
the steady state above has held for a month.
