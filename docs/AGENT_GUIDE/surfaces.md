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

## Settings — `/app/settings/<section>`

Left nav: General → `Account` (profile, delete account), `API Keys` (create /
list / delete personal keys; the secret is shown only once and is sent as
`x-macro-user-api-key`), `Notifications`, `Billing`,
`Appearance`, `Mobile App`, `Shortcuts` (interactive keyboard visualization, not a list);
Workspace → `Team`, `Tags`, `CRM`, `Connections` (email/tool OAuth), `MCP server`
(setup snippets for Claude Code / Codex CLI / Claude.ai / ChatGPT / IDE), `Bots`; `Log out`.
`Back to app` returns to the previous surface. Open via user-email button menu or `Ctrl+;`.

## Notifications

Toast regions are labeled `Notifications (alt+T)`; five empty live regions always exist in
the a11y tree (ignore them when parsing snapshots).
