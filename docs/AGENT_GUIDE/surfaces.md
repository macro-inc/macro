# Other Surfaces

## Inbox — `/app/component/inbox`

Unified triage list (emails, channel messages, task assignments, doc mentions, agent
results). Filter radios: `Signal` (default, AI-filtered "needs attention") / `Noise` / `All`
/ `Reminders`; plus `Filter` menu and `Preview` toggle (split list + preview pane; the empty
preview shows "No content selected"). With the `enable-inbox-notified-sort` flag on, `Signal`
and `Noise` order rows (and their date headers) by when you were last notified about the
item, so a fresh comment on an old task sits under "Today"; with it off they order by
recency like `All` and `Reminders`. Keyboard: `j`/`k` move, `space` preview, `enter` open, `e` mark done.
Rows are buttons named `<channel> <sender>:<snippet> <time>`.

## Email — `/app/component/mail`

Full email client. Tabs: `Signal` / `Noise` / `Sent` / `Calendar` / `Drafts` / `Shared` /
`All`. Compose via the `Email` button (or `Create` → `Email E`). On a fresh local user it
shows `Connect your email` (Gmail/Google Workspace OAuth) — most functionality needs a
connected account. Search is `Ctrl+F` within the surface.

## Search

Sidebar `Search` button → `/app/.../component/search` with a focused query box. Results
(including a `Featured Results` group) filter live as you type; no Enter needed. `Ctrl+K` is
usually faster for jump-to-entity; `/` opens workspace search when no editor is focused.

## Files — `/app/component/documents`

Tabs `Owned` / `Shared` / `Attachments` / `Folders` / `All`; `New` menu; rows show title,
tags, updated time. Clicking a row opens the doc.

## Calendar — `/app/calendar/view`

Week view with `New event`, `Choose calendar view` menu, prev/next week, `Search events`,
`Calendar settings`, and a mini month picker in the side panel. Events require connecting a
Google account (`Connect calendar`). The `Calendar settings` (gear) menu has an `Accounts`
section listing each connected account with a per-account `Enable` (grant calendar) or
`Turn off` action, plus `Connect another account` to connect a new Google account
(email + calendar).

The side panel's `Calendars` section folds each connected account into a collapsible
group: a caret plus the account address header with a checkbox that shows or hides all of
that account's calendars at once, and the account's calendars listed beneath it (color dot,
name, per-calendar checkbox). Subscribed system calendars (Google holidays, birthdays)
carry a small RSS icon.

Teammates' Google Calendar out-of-office events overlay the grid as read-only chips titled
`<name>: <event title>`. The side panel's `Team out of office` section (shown only when the
user belongs to a team with other members) has a checkbox in its header row toggling the
whole overlay on or off — all teammates or none — and lists the next 90 days of teammate
absences; clicking a row navigates the grid to that date. Coverage depends on each teammate
having connected their own calendar and using Google's out-of-office event type.

## Calls — `/app/component/calls`

Tabs `All` / `Missed` / `Unattended`; `Call` button to start one. Recordings, transcriptions
and summaries appear here; empty state notes "Calls are available to agents."

## Customers (CRM) — `/app/component/companies`

Board/List views, `Company` create button. Requires a team ("Join a team to enable CRM" →
`Open team settings`).

## Activity — `/app/component/activity`

GitHub-style actions heatmap (one a11y node per day — makes snapshots huge; prefer saving the
snapshot to a file) plus a feed of "You edited/created X" entries.

## Home — `/app/component/home`

Greeting, getting-started checklist, example prompt buttons (`Draft a document`,
`Draft an email`, `Search & research`), and the ubiquitous `Ask AI` composer.
The connect-inbox empty state opens Connections at Google.

## Settings — `/app/settings/<section>`

Left nav: General → `Account` (profile, delete account), `API Keys` (create /
list / delete personal keys; the secret is shown only once and is sent as
`x-macro-user-api-key`), `Notifications`, `Billing`,
`Appearance`, `Mobile App`, `Shortcuts` (interactive keyboard visualization, not a list);
Workspace → `Team`, `Tags`, `CRM`, `Connections` (Connected / Discover), `Macro MCP`
(setup snippets for Claude Code / Codex CLI / Claude.ai / ChatGPT / IDE; signposts
inbound connectors to Connections Discover). Connections signposts outbound
Macro MCP to `Macro MCP`. `Bots`; Agents → `Agents`, `Harness` (gated by
enable-chat-v3-agents). `Log out`.
`/app/settings/harness?pair=` still mounts Harness so pairing works.
`Back to app` returns to the previous surface. Open via user-email button menu or `Ctrl+;`.

## Settings — Connections — `/app/settings/connections`

`Connected` lists mapped providers with a capability summary. Custom MCP grants sit in
a second section. Discover's Add custom MCP saves name and URL only. Connect
on that Connected row starts OAuth. More holds Disable, Rename, Reconnect,
and Disconnect. An unauthenticated custom MCP shows Remove, not Disconnect.
The row lists host plus path and drops query params. A failed connect sits
under the URL. Connect and Enable stay on the row when that is the job.
Reconnect also sits on the row when auth is broken. No status lights on rows. Off is
shown by Enable, not a muted dot. Unmatched
Pipedream leftovers stay with the providers.
Empty state offers Google first, then GitHub, Linear, Notion,
Slack, Cursor. `Discover` searches the Pipedream catalog. Browse rows that
are not added yet connect on a click of the whole row. Featured cards are
Google, GitHub, Linear, Notion, Slack, Cursor. Click a provider for its page: Google
(Gmail + Calendar per inbox, no Docs; Gmail shows dest sync status. Signature
nests under Gmail for an owned inbox), GitHub (account, Configure app for
repos, AI),
Linear / Notion / Slack (Pipedream AI, Off is enable/disable), Cursor (API key
+ default model). Discover is `/app/settings/connections/discover`. A provider
is `/app/settings/connections/<provider>` (`github`, `google`, `cursor`, …).
Opening a Featured card from Discover writes `discover-<provider>` so Back
returns to Discover. Those are path tokens under the Connections tab, not extra Settings tabs.
Connections signposts Macro MCP to
the `Macro MCP` tab (`/app/settings/mcp-server`). That tab signposts inbound
connectors to Discover.

## Notifications

Toast regions are labeled `Notifications (alt+T)`; five empty live regions always exist in
the a11y tree (ignore them when parsing snapshots).
