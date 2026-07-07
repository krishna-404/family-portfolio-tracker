# Issue tracker

This repo's issue tracker is **GitHub Issues** on `krishna-404/family-portfolio-tracker`. Agents interact with it through the GitHub MCP tools (`mcp__github__*`); there is no `gh` CLI in the remote environment.

## Wayfinding operations

How the [wayfinder skill](https://github.com/mattpocock/skills/blob/main/skills/in-progress/wayfinder/SKILL.md)'s concepts map onto GitHub Issues here:

- **The map** is a single issue labelled `wayfinder:map`. Current map: [Wayfinder map: Ekatra — family portfolio consolidator](https://github.com/krishna-404/family-portfolio-tracker/issues/1).
- **Tickets** are GitHub **sub-issues** of the map (native parent/child via `sub_issue_write`). Each carries exactly one `wayfinder:<type>` label: `research`, `prototype`, `grilling`, or `task`.
- **Claiming**: assign the issue to yourself (the dev driving the map) *before* any work. An open, unassigned ticket is unclaimed.
- **Blocking**: the GitHub MCP toolset has no native dependency edge, so blocking uses the body convention — a final line in the ticket body:

  ```
  Blocked by: [Ticket name](issue-url) · [Other ticket name](issue-url)
  ```

  A ticket is unblocked when every issue named on that line is closed. When resolving a ticket, search open tickets for links to it in `Blocked by:` lines — those may now be unblocked.
- **Frontier query**: open, unclaimed sub-issues of the map whose `Blocked by:` line is absent or fully closed. In practice: `list_issues` with label filter `wayfinder:research`/`prototype`/`grilling`/`task`, state OPEN, then filter out assigned tickets and blocked tickets.
- **Resolution**: post the answer as a comment on the ticket, close it (`state_reason: completed`), and append a one-line gist + link to the map's **Decisions so far** section.
- **Out-of-scope tickets**: close with `state_reason: not_planned` and record a one-line gist in the map's **Out of scope** section.
- **Refer by name**: in anything a human reads, reference tickets by their title wrapping the link — never a bare `#N`.
