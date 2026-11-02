---
vendor: slack
apps: [slack, slack_v2]
state: deferred
portal: https://api.slack.com/apps
account:
submitted:
last_contact:
next_action: None in v1; Macro's existing Slack app serves Connect
next_action_owner: human
due:
---

## Requirements

Slack MCP (`mcp.slack.com/mcp`) has no DCR; user tokens only. Unlisted distribution works without Marketplace review; workspace admins may require approval.

## Scopes

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Deferred by Eric: v1 reuses Macro's Slack app; Connect registers its own later.
