# Agent Guide to the Macro App

How an automated agent (driving a real browser via the chrome-devtools MCP server, or
observing via the Grafana MCP server) should operate the Macro web app. Everything here was
verified live against a local stack (`just run_local`).

| File | Contents |
| --- | --- |
| [login.md](login.md) | Passwordless login end to end, Mailpit, known crash + recovery |
| [navigation.md](navigation.md) | Routes, sidebar, command menu, keyboard model, splits |
| [documents.md](documents.md) | Creating docs, typing in the editor, AI edit, comments, side panel |
| [ai-chat.md](ai-chat.md) | Standalone and doc-scoped AI chat |
| [channels.md](channels.md) | Channels: create, invite, message, participants, bots |
| [tasks.md](tasks.md) | Task list and creation dialog |
| [surfaces.md](surfaces.md) | Every other surface: inbox, email, search, files, calendar, calls, customers, activity, settings |
| [browser-technique.md](browser-technique.md) | Generic chrome-devtools MCP lessons learned on this app |
| [observability.md](observability.md) | Correlating a UI action to backend traces/logs with the Grafana MCP |

Local stack conventions used in examples: frontend `http://localhost:<fe>/app`, backend proxy
`http://localhost:<be>`, Mailpit `http://localhost:<mp>` (ports come from the `--instance`;
e.g. the `lgtm` instance uses 27910 / 27909 / 27908).
