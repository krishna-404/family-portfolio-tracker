# Product Spec Template (GitHub issue form: `.github/ISSUE_TEMPLATE/product-spec.yml`)

Every piece of work the loop touches enters as one of these. The bar: **a cheap model
dropped onto this issue knows exactly what to do** — no follow-up questions. Advise
will park anything that misses the bar (`AMBIGUOUS` ⇒ `needs-human`), and that is a
planning failure, not an execution failure.

---

```markdown
---
type: <task_type — e.g. ci, strip-module, harness, brain, docs, feature, bugfix>
stack: <tags for skill-matching — e.g. node, orchid, react, github-actions, bash>
tier-estimate: T0 | T1 | T2 | T3   # Advise confirms; Grade may raise
depends-on: #<issue> [, #<issue>…] # DAG edges; harness won't claim until deps closed
parallel-group: <phase>.<letter>   # e.g. 1.B — tasks in one group are independent
---

## Problem
Who/what is hurting, what happens today, why now. 2–4 sentences. For internal factory
tasks "who" is usually the loop itself or the operator — still name it.

## Bet
One falsifiable sentence: "If we ship X, then [the loop / the operator / CI] will
[observable change], verifiable by [check]."

## Success criteria  ← these become the Grade rubric's spec_fit checks, verbatim
- [ ] Criterion 1 — concrete, observable, testable. Name the command/test/file.
- [ ] Criterion 2 — …
- [ ] All of: `yarn lint`, `yarn check-types`, `yarn test:run` green in CI.

## Out of scope
Explicit non-goals. This is what keeps the scope rubric dimension enforceable.

## Evaluation
How we know it worked *after* merge (canary signal, telemetry field, follow-up check),
and the kill/revert condition.

## Context & pointers
Files, prior art in the repo, relevant `.brain/` entries, relevant skills. Everything
the executor should read BEFORE writing code. Links must resolve.
```

---

## Worked example (a real Phase 1 task)

```markdown
---
type: strip-module
stack: node, orchid, orpc
tier-estimate: T1
depends-on: #12   # CI must exist first
parallel-group: 1.B
---

## Problem
The repo carries the OneQ demo journal domain (backend `modules/journal_entries`,
`modules/prompts`). It doubles test surface and confuses every agent that greps the
codebase. The offline/sync INFRA must survive (decision D16); only the journal DOMAIN goes.

## Bet
If we remove the journal_entries backend module and its wiring, the backend builds and
tests green with zero journal references, verifiable by CI + `grep -ri journal apps/backend/src --include='*.ts' | wc -l` = 0.

## Success criteria
- [ ] `apps/backend/src/modules/journal_entries/` deleted.
- [ ] All imports/routers/events/novu-workflows referencing it removed
      (`journal_entry_created_fanout` event, `journal_entry_created` Novu workflow).
- [ ] Migration added dropping its tables; `yarn db up` clean on fresh DB.
- [ ] `grep -ri journal apps/backend/src` returns nothing.
- [ ] Sync engine tests still green (proves D16 held — infra untouched).
- [ ] `yarn lint && yarn check-types && yarn test:run` green in CI.

## Out of scope
Frontend journal pages (#14), prompts module (#15), zod-schemas cleanup (#16),
any change under modules/sync/.

## Evaluation
Post-merge canary CI green; no `journal` hits in next nightly dream's repo scan.
Revert condition: any sync test regression on main.

## Context & pointers
apps/backend/src/modules/journal_entries/ · events/events.schema.ts (fanout event) ·
novu/workflows/ · .brain/decisions.md D16.
```
