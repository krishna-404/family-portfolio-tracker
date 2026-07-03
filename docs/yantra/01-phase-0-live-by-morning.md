# Phase 0 — Live by Morning (the bootstrap runbook)

**Goal:** the v0 loop runs on the VPS on a 10-minute timer and has auto-merged its
first real T0 PR with zero human touches between `spec:ready` and merge.
**Executor:** you + one Claude Code session, pair-running this file top to bottom.
This is the ONLY phase executed by hand; every later phase is executed by the loop.
**Budget:** ~4–6 focused hours. Steps marked ⏸ can run while you wait on earlier ones.

Every task: **[who] Steps → Acceptance test** (run the test; don't eyeball).

---

## Y0.1 — Create the `yantra` repo [human, 15 min]

1. On GitHub: create **private** repo `yantra` under your personal account. No README/license/gitignore (empty).
2. Mirror the boilerplate in:
   ```bash
   git clone --bare git@github.com:shipmyapp/connected-repo.git
   cd connected-repo.git && git push --mirror git@github.com:<you>/yantra.git
   ```
3. Clone the new repo normally; delete mirrored non-main refs you don't want
   (`git push origin --delete <branch>` for stray branches).

**Accept:** `git clone git@github.com:<you>/yantra.git && cd yantra && yarn install && yarn build` succeeds on your machine or the VPS.

## Y0.2 — Rebrand + relicense commit [Claude session, 20 min] ⏸ after Y0.1

One commit on `main` of `yantra`:
- `LICENSE` → "Copyright (c) 2026 Balkrishna Agarwal. All rights reserved." (placeholder
  per D15/OD-1).
- `package.json` (root): `name: "yantra"`, `license: "UNLICENSED"`, `private: true`,
  repository URL updated. Same for `apps/*/package.json`, `packages/*/package.json`
  license fields.
- README: replace title + first paragraph with 5 lines: what Yantra is, link to
  `docs/yantra/00-overview.md`. Delete stale claims (SuprSend → Novu; remove
  "GitHub Actions CI COMPLETED" until Y0.5 makes it true). Full README rewrite is a
  Phase 1 task — do NOT do it now.
- Copy this spec: `docs/yantra/**` from connected-repo branch
  `claude/connected-repo-project-spec-ikl7mm` into the new repo unchanged.
- Delete `project.md` (OneQ pitch) and `DEVELOPMENT_PLAN.md` (superseded; its useful
  history lives in git).

**Accept:** `grep -ri "AGPL" --include="package.json" .` → 0 hits; `ls docs/yantra` shows all 9 spec files; `yarn build` still green.

## Y0.3 — GitHub scaffolding [human 10 min + Claude session 20 min, parallel with Y0.4]

Human part:
1. Fine-grained PAT (or `yantra-bot` machine user + PAT if you have minutes for it):
   repo `yantra` only; permissions: Contents RW, Issues RW, Pull requests RW,
   Actions R, Administration R, Variables RW. Save for Y0.6.
2. Repo settings: allow squash merge only; enable auto-merge; enable
   "Automatically delete head branches".
3. Create Actions **variable** `YANTRA_KILL` = `false`.
4. Create GitHub Project "Yantra" with columns: Backlog / Agent: ready / In progress / PR open / Done / Parked.

Claude-session part (PR into `yantra`):
5. Labels via `gh label create`: all labels from loop-protocol §1 (script it:
   `ops/yantra/setup-labels.sh`, idempotent).
6. `.github/ISSUE_TEMPLATE/product-spec.yml` — issue form implementing
   `templates/product-spec.md` (fields: type, stack, tier-estimate, depends-on,
   parallel-group, problem, bet, success criteria, out of scope, evaluation, context).

**Accept:** `gh label list -R <you>/yantra | wc -l` ≥ 12; opening a new issue on GitHub shows the "Product Spec" form; `gh variable list` shows `YANTRA_KILL`.

## Y0.4 — Minimal CI [Claude session, 30 min] ⏸ parallel with Y0.3

`.github/workflows/ci.yml`, triggers `pull_request` + `push: main`:
- Job `checks`: node 22, yarn cache, `yarn install --frozen-lockfile`, `yarn build`,
  `yarn lint`, `yarn check-types`.
- Job `tests`: Postgres 16 service container, `yarn test:db:setup`(adapted env), `yarn test:run`.
- Branch protection on `main`: require both jobs + 0 approvals (you merge via review
  anyway; the loop needs mergeability without a second human).

Playwright E2E, coverage gates, knip = Phase 1 (Y1.A) — resist scope creep tonight.

**Accept:** open a trivial PR (touch README) → both checks run and pass → auto-merge allowed only when green (verify by pushing a failing test to a scratch branch and confirming red blocks merge).

## Y0.5 — VPS bootstrap [human on SSH + Claude session writing files, 60–90 min]

1. Dirs: `/opt/yantra/{bin,prompts,telemetry,env}` (env dir `chmod 700`).
2. Install: docker (present via Dokploy), `gh`, `git`, node 22 (for host-side jq-ish
   scripting use `node -e` or install `jq`).
3. Credentials in `/opt/yantra/env/yantra.env` (`chmod 600`):
   `GH_TOKEN=<PAT>` · `CLAUDE_CODE_OAUTH_TOKEN=<output of 'claude setup-token' run on your Mac>` ·
   `NOVU_SECRET_KEY=<existing>` · `YANTRA_REPO=<you>/yantra`.
4. Build the exec image: `ops/yantra/Dockerfile` per loop-protocol §7;
   `docker build -t yantra-exec:0 ops/yantra/`.
5. Sanity: `docker run --rm --env-file /opt/yantra/env/yantra.env yantra-exec:0 claude -p "Say READY" --model sonnet` prints READY (proves sub auth works in-container).
6. Novu smoke: trigger the existing `user_created`-style test workflow via curl with
   the secret key; confirm a push/email lands. (The dedicated `yantra-needs-you`
   workflow is task Y1.D2; tonight any delivered notification proves the pipe.)

**Accept:** step 5 prints READY; step 6 notification received on your phone.

## Y0.6 — Loop v0 scripts [Claude session, the big one, 90–120 min]

`ops/yantra/` in the `yantra` repo (deployed to VPS by `git pull` — the VPS clone at
`/opt/yantra/repo` IS the deployment):

| File | Contract |
|---|---|
| `loop-tick.sh` | Implements loop-protocol §2 exactly: preconditions → claim → advise → execute → grade → dream micro-write. One issue per tick max. Exit 0 always (log errors, park work; a crashing tick must not wedge the timer). |
| `advise.sh` | Wraps `claude -p` with `prompts/advise.md` + issue JSON; parses fenced JSON output; applies labels/comments. |
| `execute.sh` | `docker run yantra-exec:0` with the execute prompt; in-container: clone, branch, work, self-check (`lint/check-types/test:run`), push, `gh pr create`. |
| `grade.sh` | Runs on PRs labeled `agent:pr-open` with green CI and no verdict comment yet; posts verdict; if PASS+T0 → rails check (R1–R4) → `gh pr merge --squash --auto`; if FAIL → retry orchestration per §2.4. |
| `canary.sh` | On `push: main` CI completion (polled): red ⇒ R5 sequence (revert PR, kill switch, Novu). |
| `dream-nightly.sh` | 03:00 IST cron: consolidation per §2.5. |
| `notify.sh` | curl → Novu trigger endpoint; events: `needs-human`, `review-digest`, `killed`. |
| `prompts/{advise,execute,grade,dream-nightly}.md` | Per loop-protocol §3, each with `prompt-version: 1`. |
| systemd | `yantra-loop.service` (oneshot) + `yantra-loop.timer` (10 min) + `yantra-dream.timer` (daily 03:00 IST). |

Rules for the writer: bash + `gh` + `jq` + `docker` only; every state transition logged
one-line to `/opt/yantra/telemetry/loop.log`; every run appends the §5 telemetry JSON
line; no secrets ever echoed.

**Accept (scripted dry-run, before real issues exist):**
1. `YANTRA_KILL=true` set → `./loop-tick.sh` exits 0 logging `killed`, no API writes (verify with `gh api /rate_limit` unchanged writes… simpler: assert no issue labels changed).
2. Fixture issue labeled `spec:ready` with a deliberately vague body → tick parks it `needs-human`, Novu fires, claim released.
3. Unit-test the rails: `grade.sh` sourced with a stubbed 160-line-diff PR JSON → refuses auto-merge citing R2.

## Y0.7 — Seed the first backlog [Claude session, 30 min]

File the Phase 1 issues from `06-seed-backlog.md` (at minimum: all of group 1.A and
1.B) using the issue form, wired with `depends-on` and `parallel-group` fields, all in
Project column `Backlog`. Move ONLY `SB-1` (the smoke test) to `Agent: ready`.

**Accept:** `gh issue list -R <you>/yantra --label spec:ready` shows exactly SB-1; the rest sit in Backlog with correct dep links.

## Y0.8 — SMOKE TEST = P0-EXIT [both of you watching, 30 min]

SB-1 (a genuine T0: "Fix the three stale README claims", spec'd in the seed backlog)
sits in `Agent: ready`. Start the timer: `systemctl start yantra-loop.timer`. Then
**touch nothing**.

**P0-EXIT checklist (all must be true):**
- [ ] Tick claimed SB-1 (labels + claim comment correct).
- [ ] Advise posted PROCEED/T0 JSON.
- [ ] Execute container opened a PR with spec-checklist body; CI went green.
- [ ] Grade posted PASS with evidence lines; rails R1–R4 held; PR **auto-merged**.
- [ ] Canary: next `main` CI green; no revert.
- [ ] Telemetry line exists with `outcome: "grade_pass_first_try"`, `auto_merged: true`.
- [ ] Dream micro-write present (inbox stub or explicit "no lesson" log line).
- [ ] Kill-switch drill: set `YANTRA_KILL=true`, move SB-2 to ready, watch two ticks do
      nothing but log; set back to `false`.
- [ ] You received the Novu review-digest (or needs-human from the drill) on your phone.

When all boxes tick: move the rest of group 1.A + 1.B to `Agent: ready` before you
sleep. **Phase 1 has begun; the factory is running while you rest.**

## Failure playbook (tonight only)

- Any step > 2× its budget: cut scope, not corners — e.g. skip Y0.3.6 (issue form) and
  file SB-1 as a raw markdown issue; skip the Novu smoke and use `gh` CLI notifications
  for one night. The ONLY non-negotiables: kill switch, rails R1–R4, containerized
  execute, CI-required-for-merge.
- Claude auth fails in-container: run execute on host tonight (still branch-isolated),
  file "containerize execute" as SB-0 for tomorrow. Do not skip the rails.
- If morning arrives with P0-EXIT incomplete: the loop does NOT get auto-merge rights.
  Flip `YANTRA_KILL=true`, leave everything queued, finish tonight's residue in the
  evening window. Rushed rails are how factories burn down.
