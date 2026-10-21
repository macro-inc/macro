# Agent Guide to the Macro App

How an automated agent (driving a real browser via the chrome-devtools MCP server, or
observing via the Grafana MCP server) should operate the Macro web app. Everything here was
verified live against a local stack (`just run_local`).

| File | Contents |
| --- | --- |
| [login.md](login.md) | Passwordless login end to end, Mailpit, known crash + recovery |
| [navigation.md](navigation.md) | Routes, sidebar, command menu, keyboard model, splits |
| [documents.md](documents.md) | Creating docs, typing in the editor, AI edit, comments, Word (DOCX) editor, PowerPoint presentations, Figma designs, Photoshop and Illustrator editors, Photoshop and Illustrator documents (AI tools, search), side panel |
| [databases.md](databases.md) | Properties, records, kanban boards, saved views, AI questions, live answers |
| [forms.md](forms.md) | Forms: create doors, builder (drag and drop, gates), respond route, Responses grid, sharing, polls |
| [ai-chat.md](ai-chat.md) | Standalone and doc-scoped AI chat |
| [claude-cloud-demo.md](../runbooks/claude-cloud-demo.md) | Claude in Harness settings, encrypted saved connection, Open in Claude, and cloud-side transcript polling |
| [channels.md](channels.md) | Channels: create, invite, message, participants, bots |
| [tasks.md](tasks.md) | Task list and creation dialog |
| [view-tours.md](view-tours.md) | Desktop feature flyovers, dismissal, targeting, and embedded videos |
| [reminders.md](reminders.md) | Email snoozing, the reminder command menu, delivery, and safe failure verification |
| [home.md](home.md) | Home and the mobile Notifications inbox |
| [email.md](email.md) | Mail: threads, read state, trash, cached filtering, reminders |
| [calendar.md](calendar.md) | Calendar views, Scheduling workspace, booking links, events, and invitations in email |
| [search.md](search.md) | Search |
| [files.md](files.md) | Files (Drive) |
| [calls.md](calls.md) | Calls, call links, guests, and sharing |
| [crm.md](crm.md) | Customers (CRM) |
| [pull-requests.md](pull-requests.md) | Pull request review |
| [activity.md](activity.md) | Activity |
| [notifications.md](notifications.md) | Notifications |
| [settings.md](settings.md) | Settings sections, including Slack import and team membership |
| [onboarding.md](onboarding.md) | Onboarding bypass and setup plan |
| [canvas.md](canvas.md) | Canvas colors and link paste |
| [soup-live-updates.md](soup-live-updates.md) | Live updates in flat Soup lists |
| [ui-conventions.md](ui-conventions.md) | Shared UI behavior: list loading, top bars, dialog actions, user cards, information panels |
| [browser-technique.md](browser-technique.md) | Generic chrome-devtools MCP lessons learned on this app |
| [observability.md](observability.md) | Correlating a UI action to backend traces/logs with the Grafana MCP |

Local stack conventions used in examples: frontend `http://localhost:<fe>/app`, backend proxy
`https://localhost:<be>` (checked-in self-signed cert; trust `infra/local/certs/ca.pem`), Mailpit `http://localhost:<mp>` (ports come from the `--instance`;
e.g. the `lgtm` instance uses 27910 / 27909 / 27908).

For remote browser testing, trust `infra/local/certs/ca.pem` and open the
printed `https://<hostname>:<proxy-port>/app/` URL. The launcher calls `hostname`
and includes it in both the generated certificate and Vite's allowed hosts.
Caddy forwards frontend assets and HMR to Vite while routing API and backend
WebSockets directly. No Tailscale setup is required; the browser needs network
access to that hostname and port. Plain HTTP on a remote hostname cannot retain
secure login cookies.

Standalone `bun run dev` uses the same CA and serves HTTPS directly through
Vite. Hosted dev API and WebSocket requests use `/__macro_dev/` on the page
origin, with auth cookies scoped to that hostname. Use email-code sign-in; the
hosted Google/SSO redirect allowlist does not include arbitrary hostnames.
Email magic links retain the page's HTTP or HTTPS scheme and port.
On allowed OAuth origins such as `https://localhost`, standalone Vite uses the
session-code handoff to establish cookies on the local hostname after SSO.

For the standalone marketing site, verify cold product-page navigation with the
route module delayed: prerendered content must remain until the page is ready.
On mobile, the single hamburger opens and closes navigation; there is no separate
caret. Check Escape focus return and keyboard wrapping inside the open menu.
