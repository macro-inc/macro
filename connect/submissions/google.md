---
vendor: google
apps: [google_drive, google_sheets, gmail, google_calendar, google_docs, google_slides, google_chat, google_analytics, google_search_console, google_tasks, google_meet, google_classroom, google_cloud]
state: deferred
portal: https://console.cloud.google.com
account:
submitted:
last_contact:
next_action: None until Eric reopens Google
next_action_owner: human
due:
---

## Requirements

MCP servers (`*mcp.googleapis.com`) accept no DCR or CIMD: Macro Connect's own Google OAuth client, "Use this client for an AI-powered agent" ticked, MCP services enabled, Workspace MCP Developer Preview enrollment. Sensitive scopes (Calendar, Sheets, Docs, Slides via `drive.file`, Analytics, Search Console): verification. Restricted scopes (Gmail, full Drive, Chat): verification plus annual CASA assessment. File sensitive and restricted as separate requests. 100-user cap until verified. Gmail's 401 points `resource_metadata` at a per-tool path.

## Scopes

## Log

- 2026-10-30: Record created from [the research](../docs/research/vendor-auth.csv).
- 2026-10-30: Punted by Eric; Google connections stay on Pipedream.
