# Yantra Grade Rubrics

The Grade role scores every PR against the tier-appropriate rubric below. The grader
did not write the code and must verify against **artifacts** (diff, CI logs, test
names), never against the PR body's claims. Output format: loop-protocol.md §2.4.

## Scoring

Four dimensions, each 0–2. **PASS requires: every spec success-criterion `met: true`
with evidence, AND no dimension scored 0, AND total ≥ 6/8.**

| Dimension | 2 | 1 | 0 (auto-FAIL) |
|---|---|---|---|
| **spec_fit** | Every success criterion demonstrably met; nothing extra shipped | Criteria met but with minor interpretation stretches (noted) | Any criterion unmet or hand-waved ("should work") |
| **tests** | New/changed behavior covered by tests that fail without the change; suite green | Covered but assertions are weak/indirect | Behavior change with no test delta, or tests weakened/deleted/skipped to pass |
| **scope** | Diff ⊆ plan's `files_expected` + justified additions; no drive-by edits | Small unrelated cleanups, each ≤ 5 lines, harmless | Unrelated refactors, formatting storms, or touches to rail-protected paths (loop-protocol §6 R2) |
| **quality** | Reads like the surrounding code; conventions (`.brain/conventions.md`) followed; no hacks | Works but one flagged inelegance (comment it on the PR) | Hack that a maintainer would revert on sight: swallowed errors, `any`-spam, copy-paste duplication of an existing helper, magic sleeps |

## Tier definitions + per-tier extras

### T0 — mechanical (auto-merge eligible)
Docs, comments, dead-code removal (knip-confirmed), lockfile/format churn, string/typo
fixes, config value changes explicitly listed in the spec.
**Extra checks:** diff ≤ 150 lines / ≤ 5 files; zero behavior change (grader states why
it's provably behavior-neutral — e.g. "deleted export had no references; knip output in
CI log"); touches no rail-protected path. If the grader cannot prove behavior-neutrality,
the change is not T0 — re-tier to T1.

### T1 — low-risk code
Single-module changes, additive utilities, test additions, UI copy/layout tweaks,
non-breaking API additions.
**Extra checks:** no exported-interface changes consumed outside the module (grader
greps callers); migration-free; rollback = plain revert.

### T2 — feature / multi-file
New modules, cross-module changes, schema migrations, new dependencies.
**Extra checks:** migration has a down-path or explicit "irreversible, because…" in the
PR body; new dependency justified against `.brain/decisions.md` D-entries (adopt-and-
compose test: "does something we already ship do this?"); integration test exercises
the seam end-to-end, not just units.

### T3 — sensitive (never auto-merged, ever)
Auth, secrets handling, CI workflows, the harness (`ops/yantra/`, `apps/yantra/`),
prompts, routing table, `.brain/` promotions, LICENSE, dependency major-bumps.
**Extra checks:** grader must enumerate the blast radius ("if this is wrong, what
breaks?"); a second independent grade run with a different prompt seed must also PASS
(two-grader agreement); explicit human approval required regardless of scores.

## Grader integrity rules

1. Evidence or it didn't happen: every `met: true` cites file:line, a test name visible
   in CI output, or a CI check URL.
2. Tier honesty: re-derive the tier from the diff alone; your tier overrides Advise's
   if higher (loop-protocol §2.4).
3. FAIL must be actionable: each failure names the criterion, the gap, and what passing
   would look like — the retry prompt is built from your words.
4. You may not suggest weakening the spec. If the spec itself is wrong, verdict FAIL
   with `failures: ["spec defect: …"]` — that routes to needs-human, which is correct.
5. Elegance loop caveat (plan §9): if you request a cleanup, the retry re-enters the
   full gate — never "pass, but tidy later."
