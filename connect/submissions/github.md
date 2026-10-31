---
vendor: github
apps: [github]
state: deferred
portal: https://github.com/organizations/macro-inc/settings/applications
account:
submitted:
last_contact:
next_action: None in v1; Macro's existing GitHub OAuth app serves Connect
next_action_owner: human
due:
---

## Requirements

Copilot MCP (`api.githubcopilot.com/mcp`) has no DCR or CIMD. GitHub OAuth apps need no review. Macro's own app exists, but Connect needs its own (separate product, separate secrets).

## Scopes

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Deferred by Eric: v1 reuses Macro's GitHub app; Connect registers its own later.
