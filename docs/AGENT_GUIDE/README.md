# Agent Guide to the Macro App

How an automated agent (driving a real browser via the chrome-devtools MCP server, or
observing via the Grafana MCP server) should operate the Macro web app. Everything here was
verified live against a local stack (`just run_local`).

| File | Contents |
| --- | --- |
| [login.md](login.md) | Passwordless login end to end, Mailpit, known crash + recovery |
| [navigation.md](navigation.md) | Routes, sidebar, command menu, keyboard model, splits |
| [documents.md](documents.md) | Creating docs, typing in the editor, AI edit, comments, Word (DOCX) editor, PowerPoint presentations, side panel |
| [databases.md](databases.md) | Properties, records, kanban boards, saved views, AI questions, live answers |
| [ai-chat.md](ai-chat.md) | Standalone and doc-scoped AI chat |
| [../CLAUDE_CLOUD_DEMO.md](../CLAUDE_CLOUD_DEMO.md) | Claude in Harness settings, encrypted saved connection, Open in Claude, and cloud-side transcript polling |
| [channels.md](channels.md) | Channels: create, invite, message, participants, bots |
| [tasks.md](tasks.md) | Task list and creation dialog |
| [support.md](support.md) | Team Support inbox, independent tickets linked to Tasks, CRM history, agent controls, website widget, and email intake (fixture browser verification) |
| [view-tours.md](view-tours.md) | Desktop feature flyovers, dismissal, targeting, and embedded videos |
| [reminders.md](reminders.md) | Creating and editing reminders, scheduling controls, and safe failure verification |
| [surfaces.md](surfaces.md) | Every other surface: inbox, email, search, files, calendar, calls, customers, activity, settings |
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
