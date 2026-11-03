---
vendor: microsoft
apps: [microsoft_teams, microsoft_outlook, microsoft_outlook_calendar, microsoft_onedrive]
state: excluded
portal: https://entra.microsoft.com
account:
submitted:
last_contact:
next_action: None; excluded from v1
next_action_owner: human
due:
---

## Requirements

Microsoft's MCP servers (Agent 365) need Agent 365 plus Microsoft 365 Copilot licences per user; the authorization server has no DCR or CIMD. Would need a multitenant Entra app and publisher verification (Microsoft AI Cloud Partner Program ID).

## Scopes

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Excluded by Eric: MCP needs Agent 365 and Copilot licences.
