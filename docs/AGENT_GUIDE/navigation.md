# Navigation and App Structure

## Direct URLs (all under the frontend origin)

| Route | Surface |
| --- | --- |
| `/app` | Redirects to inbox |
| `/app/welcome` | Login page (when unauthenticated) |
| `/app/component/inbox` | Unified inbox |
| `/app/component/mail` | Email client |
| `/app/component/channels` | Channels list |
| `/app/component/documents` | Files (documents list) |
| `/app/component/tasks` | Tasks table |
| `/app/component/agents` | AI chats / agents list |
| `/app/component/calls` | Calls list |
| `/app/component/companies` | Customers (CRM; needs a team) |
| `/app/component/activity` | Activity heatmap + feed |
| `/app/component/home` | Home (AI-first landing) |
| `/app/calendar/view` | Calendar |
| `/app/md/<uuid>` | A document |
| `/app/chat/<uuid>` | A standalone AI chat |
| `/app/agent/<uuid>` | An agent session (opened from `@macro-new` / `@coder` / `@cursor`) |
| `/app/md/<doc>/chat/<chat>` | Doc + doc-scoped chat in a split |
| `/app/md/<doc>/channel/<channel>` | Doc + channel in a split |
| `/app/settings/account` | Settings (also `/app/settings/api-keys`, `/mcp-server`, `/shortcuts`, etc.) |

Splits: the app is a tiling window manager. A second pane appends its own segment to the URL
(`/app/<left>/<right>`). Each pane has its own Close / Go Back / Go Forward buttons.

## Sidebar (a11y names are load-bearing)

- Top: buttons `Search` and `Create`.
- Nav: `Go to Home`, `Go to Getting Started`, `Go to Inbox`, `Go to Recent`, `Go to Activity`.
- Workspace: `Go to Email`, `Go to Channels`, `Go to Calls`, `Go to Files`, `Go to Tasks`,
  `Go to Calendar`, `Go to Agents`, `Go to Customers`.
- Then `Favorites` (pinned items) and `Latest` (recent channels/DMs with an `Unread` switch).
- Bottom: button named after the user's email — menu with `Command menu (Ctrl K)`,
  `Settings (Ctrl ;)`, `Log out`.

## Create menu

`Create` button (top-left) opens a menu of: Email E, Automation U, Coding Agent A, Skill K,
Document D, Task T, Reminder R, Snippet S, Message M, Channel G, Canvas N, Folder F, Code O.
Document navigates straight into a new doc; Task and Channel open dialogs.

## Command menu (Ctrl+K)

Opens a dialog with a focused `Search...` textbox and category radios
(All / Command / Agents / Files / Tasks / Channels / People). Type a name, press Enter to open
the top hit. Also exposes commands: `Create`, `Change theme`, `MCP setup`. Keys: Tab cycles
category, Esc closes.

## Keyboard model (from the in-app guide; verified partially)

- `Ctrl/Cmd+K` — jump to anything by name.
- `c` then `d`/`t`/`e`/`m`/`a` — create doc / task / email / channel / AI chat.
  Single-letter shortcuts only work when no editor has focus; press `Escape` first.
- `/` — search everything. `j`/`k` — move in lists. `e` — mark done. `g` then `i` — inbox.
- Splits: `` ` `` split, `Shift+H`/`Shift+L` move focus, `Shift+Esc` maximize.
- In any text surface: `@` mentions (bidirectional links), `#` tags, `/` block commands,
  `:` emoji.
