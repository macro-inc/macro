# Agent Guide to the Macro App

How an automated agent (driving a real browser via the chrome-devtools MCP server, or
observing via the Grafana MCP server) should operate the Macro web app. Everything here was
verified live against a local stack (`just run_local`).

The public website also has an isolated [sample workspace](../../apps/marketing/README.md#interactive-sample-workspace) at `/demo`; it does not operate on authenticated app data. The homepage embeds that workspace at `/#interactive-demo` over a grainy gradient that expands from the feature bubbles on scroll, followed by the full open-source section with GitHub stars, a16z backing, and security badges. A continuous gradient funnels into the GitHub mark on scroll, then drains away; reduced motion shows the finished state. Its `/demo?embedded=true` frame hides the sample banner; the standalone `/demo` route retains it. A benefit carousel fades the preview into headlines for One inbox, Chat, Docs, Tasks, CRM, and Agents. Use its arrows, dots, keyboard arrows, or drag/swipe the caption horizontally to select a highlight. Vertical gestures keep scrolling the page; the caption captures horizontal drags even when released outside it. The demo is always interactive: clicking or typing keeps the fade and carousel in place. Direct sidebar navigation follows the matching highlight. Below 800px, the homepage instead uses the original feature bubbles → open source → curved connector → sidebar diagram sequence, without mounting the demo or carousel. On desktop, the older sidebar graphic remains behind the disabled `SHOW_SIDEBAR_BREAKDOWN` flag in `HomepageSections.tsx`. When enabled, that button opens the demo in a large modal; the close button, red traffic light, or Escape returns to the homepage. In that sample, Home items open inside Home, channel threads expand inline, and email replies use the last message card. Email supports local tag editing in its details panel, tag filters, and Favorites. Its New button and `C` open a centered create palette with search and keyboard selection. Search and `⌘K` / `Ctrl+K` open the same floating search palette without replacing the current view. Type to filter sample items; use category tabs (or Tab), arrow keys and Enter to select, and Escape to close. Embedded demos handle shortcuts only while focus is inside the demo. Rail tooltips appear to the right inside the demo’s style scope. See its linked README for local-only verification steps.

The sample's document and task tags use a plus-button picker. Select or deselect
tags there, then reopen the item to verify the session-only changes persist.

Sample channels and DMs contain longer fictional histories with replies, reactions,
and linked tasks, docs, and emails. They open at the latest messages; scroll up in
the conversation to read earlier chatter while the top bar and composer stay fixed.
Home thread links expand and scroll to their root instead. Check switching channels,
expanding a thread, and sending a new local message while scrolled into history.

On the homepage, the **Document version history** slider below Julia’s document edits controls the document above it. Drag the blue handle backward and forward, or focus it and use arrow keys, Home, and End. Grabbing it pauses playback and keeps the selected version after release. Reduced motion starts with the completed document and still allows manual scrubbing.

The public `/startups` page is retired. Old links redirect to the homepage; it
is absent from navigation and the sitemap.

In `/demo`, **Agents** opens a local catalog with Macro, Cursor, and Claude Code.
The conversation list includes sample PR/branch details and request bubbles. Home interleaves DMs, channel activity, replies, AI chats, coding sessions, email, and a few files and tasks. Reply entries open their expanded channel thread inside Home; coding entries open the corresponding sample PR conversation.
Drive includes tagged documents, a canvas/code preview, and an editable sample
spreadsheet. Task details link to related files. Calendar events open a summary
popup with attendees and local RSVP controls; use **Edit event** for its form,
**Done** to return to the summary, and Escape to close it. Email sender avatars
and participant chips use website-owned sample portraits.

| File | Contents |
| --- | --- |
| [login.md](login.md) | Passwordless login end to end, Mailpit, known crash + recovery |
| [navigation.md](navigation.md) | Routes, sidebar, command menu, keyboard model, splits |
| [documents.md](documents.md) | Creating docs, typing in the editor, AI edit, comments, side panel |
| [ai-chat.md](ai-chat.md) | Standalone and doc-scoped AI chat |
| [../CLAUDE_CLOUD_DEMO.md](../CLAUDE_CLOUD_DEMO.md) | Claude in Harness settings, encrypted saved connection, Open in Claude, and cloud-side transcript polling |
| [channels.md](channels.md) | Channels: create, invite, message, participants, bots |
| [tasks.md](tasks.md) | Task list and creation dialog |
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

### Demo mentions

Editable sample fields on the public website and `/demo` share a local `@` menu.
Type `@` for people, documents, tasks, spreadsheets, agents, and channels; continue
typing to filter. Arrow keys select, Enter or Tab inserts, and Escape closes.
Selecting a mention keeps the draft in its editor; it does not send the message.
Search and signup fields do not open this menu. These references are mock text,
with no notifications, permissions, or authenticated workspace changes.

### Public email feature demos

At `/email`, the automatic-tagging demo, channel-sharing demo, and keyboard demo
use local sample data only. Open an incoming email and use **Tags** to add or
remove a tag. In the sharing demo, choose **Share**, then **launch**, then
**Share** to open the channel; the email link reopens the original sample thread.
The sharing walkthrough ends with a simulated new reply appearing in that same
shared thread. A mouse pointer follows the sharing controls during automatic
playback and disappears when you interact. The email and channel use the same
fixed-height frame; longer conversations scroll inside it. Each animation runs once and leaves its final result visible.
Focus the keyboard demo before pressing **J/K** to navigate, **E** to archive,
**Enter** to open, or **Esc** to return to its inbox. Shortcuts do not act outside
that demo. The five shortcut buttons below the inbox also perform these actions;
the active key is highlighted during playback. Manual interactions pause playback.
There are no playback or replay buttons.
Automatic playback pauses offscreen and respects reduced motion.
The fourth section, **Agentic editing**, pairs the homepage conversation bubbles
with its generated email composer. After generation finishes, edit the subject,
recipients, or body. **Send email** only shows a local demo confirmation; it does
not send mail.
The email page uses the homepage closing section: its header **Open app** link
slides into the footer on scroll and returns to the header when scrolling up.

### Public CRM feature demos

At `/crm`, the desktop preview opens the sample company board. Open a company,
change its stage or owner, and return to the board to verify the local change.
The shared Customers sidebar keeps Board/List directly below New company,
followed by Views, in both `/demo` and the embedded CRM preview.
The first feature demo reuses `WorkspaceCompanies` from `/demo`: a message asks
Claude to set The Meadow to Demo, assign Jacob, and save Alex’s rollout role in
the company description. The visible cursor follows those fields on desktop.
It runs once while visible, pauses on pointer/keyboard interaction, and shows
the finished record for reduced motion. On mobile, use the details toggle to
inspect stage and owner. The shared-context section opens The Meadow directly:
add a comment, open its linked email, or toggle the details panel to edit properties.
The enrichment example fills in four fictional company details while visible.
The connected-work example opens the same customer record from a rollout plan
or team chat: use its two context buttons and the company mention. Manual
interaction pauses its walkthrough; reduced motion shows the completed record.
The agent section illustrates two pipeline moves from a conversation request.
These demos use fictional local data and never update an authenticated workspace.
They have no playback controls. The header's **Open app** link uses the same
scroll-to-footer animation as the email page.

### Public product-page demonstrations

At `/channels`, `/documents`, `/agents`, `/calls`, and `/github`, use
**On this page** to reach each focused demonstration. On `/tasks`, scroll past
the founder letter and use the numbered creation steps. These are fictional,
local examples, separate from authenticated workspace data. Email is their
visual reference; `/crm` is outside this rollout.

- Tasks: the founder letter precedes two finite creation walkthroughs. Convert
  an existing message through **Create task**, edit the draft and assignee, then
  submit; or write in the channel, enable **Send as task**, assign someone, and
  send. Step buttons revisit the flow, and interaction stops autoplay. Both
  paths retain the source channel and use local sample data. Open **From launch**,
  edit the brief, properties, or checklist, and use **My Tasks** with search.
- Channels: open the shared document, expand **2 replies**, and reply inside the
  thread. Chat navigation switches between channels and DMs.
- Documents: edit the working draft, add discussion, open its linked task, or
  use **Share** to choose a teammate and Edit/Comment/View access. Reopen Share
  to verify the chosen access persists.
- Agents: inspect the referenced launch plan, open the created task, or edit the
  email draft. **Send email** puts the edited draft in this example's Sent view.
- Calls: open the channel's recorded check-in, select a transcript timestamp,
  and share the record. No real audio, video, or device permission is requested.
- Reviews: combine **Involving me**/**All reviews** with search, open the matching
  PR, filter bot discussion, and open the task's linked PR. GitHub comments are
  read-only here; code changes use the agent diff presentation.

Walkthroughs have no playback controls. They finish on the working item; pointer
or keyboard input stops scripted changes, including later motion-preference
changes. Reduced motion shows the completed result. Scroll down and back up to
verify the single **Open app** CTA moves between the header and closing section.
