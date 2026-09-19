# AI Chat (Agents)

## Where chats live

- If session creation fails, the session view shows **Unable to start this agent**
  with the service's reason. Repository access requires a GitHub connection to
  Macro that covers that repository; connecting only Cursor does not grant Macro
  GitHub access. Cloud agents also need a public agent gateway: Docker-only hostnames
  cannot receive their MCP callbacks. Check the runtime error before retrying, and
  start a new Claude session after correcting its gateway network configuration.

- Open **Go to Agents** → `/app/component/agents`. With AI agents enabled
  (`enable-chat-v3-agents`), the workspace uses one sidebar for Chat and Code.
  **New conversation** opens the composer. **Conversations** is a mixed list
  of chats and coding sessions, newest first, with one search across both.
  Chat rows use a chat icon; coding rows use `</>` (the PR status icon when a
  pull request is linked). Home and the Agents sidebar share these agent rows.
  Rows have no agent or runtime-status subtext. A session that is starting or
  whose turn is still running (the agent is working, writing code, or stopping)
  shows the same three-dot working wave as the transcript in place of the
  leading icon; the row's accessible name appends `Starting` or `Working`.
  Sessions with a linked PR show
  **View PR #<number> in GitHub** beneath the title; clicking it opens the synced
  GitHub PR entity in a split (the same destination as the session header chip
  and Magic Chip). Until GitHub has synced the entity it opens GitHub in a new
  tab. Either click leaves the session unopened. The leading icon reflects the PR status. Changing the composer mode does not filter the sidebar.
  Selecting a row opens its own mode; Shift-click opens it in a new split.
  Right-click (or long-press on mobile) opens the same entity menu as Home:
  Rename, Favorite, Copy link, Share, Delete, and the other session actions.
- The starting page has a compact composer that starts at one line and grows
  with longer prompts or Shift+Enter. Lists, quotes, headings, and other
  non-paragraph blocks expand immediately, even with short text. This also applies
  to session composers. The editor takes the full width and controls move below;
  returning to a short paragraph restores the compact row. Height changes animate
  over 150ms, with reduced-motion preferences respected. **Agent** and **Send**
  sit inside the input on the right.
  Direct model selections show only the model name and provider icon in the input.
  Saved and coding agents show their identity beside the current model. There is
  no Chat/Code switch or separate model button.
- The agent dropdown includes every saved agent regardless of runtime, plus Cursor,
  grouped in **Models**, **Agents**, and **Coding agents** sections. **Models** lists
  Macro’s available models with readable names (for example, **Sonnet 5**) and
  provider icons aligned with the agent icons. The chat catalog offers Sonnet 5,
  Opus 5, and Haiku 4.5; older Sonnet and Opus versions are not offered.
  Selecting a model here selects
  the default runtime and applies that model to the next send, retracting the repository drawer.
  The built-in Macro agent is the only agent excluded from these sections; its models remain available.
  Unavailable paired agents stay visible with a reason. Model discovery uses the
  selected runtime, including Claude Cloud. Every coding agent opens the repository
  drawer; chat agents hide it. Repository/branch overrides are currently applied
  only to Cursor sessions by the create-session API.
  Coding agents carry a `</>` badge. The most recently used supported,
  available agent is selected initially; otherwise Macro is selected.
  Hover an agent (or use the right arrow key) to open its model submenu, with
  the searchable Settings catalog, provider icons, and scrollable **More models**.
  Clicking an agent directly uses its default; choosing a submenu model selects
  both the agent and that model. A checkmark identifies the selected model,
  including when it is the agent’s configured default; there is no separate default row.
  Disconnected Cursor offers **Connect Cursor**, opening Settings → Harness.
  The built-in sandbox and paired macrod runtimes are not offered here.
- Selecting an agent changes the heading: **What should we work on?** for chat
  agents and **What should we build?** for coding agents. The draft stays intact
  when changing agents. **Create agent** stays pinned at the bottom of the dropdown
  while the agent and model lists scroll. It opens the roster on the selected kind's
  tab, where either kind can be created.
- Selecting a coding agent reveals a repository drawer directly under the input
  with a short slide and fade; it extends 32px behind the rounded input and stays
  behind it throughout the transition, keeping its existing edge-muted border.
  Selecting a chat agent retracts it. Reduced-motion
  preferences disable the animation. The hidden drawer is inert. **Repository**
  (**Choose repository** until one is picked) opens a searchable list:
  **Choose automatically**, then the repositories the signed-in user reaches
  through Macro's GitHub App (`GET /agent-repositories` on the agent harness),
  recently used ones first. A new conversation always starts on **Choose
  repository** (Automatic); the last used repository is not preselected.
  Typing filters the list to those reachable repositories. Unlisted GitHub
  URLs and recents the listing no longer carries are not offered. Arrow keys
  move the highlight and Enter or a click picks it; there is no separate
  confirm button. Someone who reaches no repository sees a hint with **Connect
  GitHub**, which opens Settings → Connected. Listed recents are remembered
  per user in local storage and offered first, without changing the Automatic
  default. Once selected, **Branch** shows the repository's default branch (`main` when it
  has none) and opens a starting-branch field confirmed with **Use branch**;
  picking a different repository resets the branch to that repository's
  default. Omitting the branch on the create-session API likewise starts on
  the repository's default branch.
  Both controls open above the drawer without clipping. The selections survive
  agent changes and are sent only to coding agents. Cursor honors the explicit
  repository and branch instead of choosing a repository from the prompt;
  the owner must have access through the connected GitHub App.
- Sending starts a session with the chosen agent's configured default model;
  a model selected from its submenu overrides that default for the next send
  only. Sending or choosing another agent clears the override. This does not
  update the saved agent; configure persistent defaults in the agent editor.
  Within an existing session, the model picker remains available on the right.
  Its trigger, model options, and session metadata use the same readable model names
  as the new-conversation picker. The menu includes provider icons, search, a short
  **Recommended** list, and a scrollable **More models** submenu shared with Settings.
- Chat agents' empty input cycles tips about connectors, skills, mentions, and
  agents; coding agents show **Describe what you want to build**. Type `@` for
  mentions and `/` for skills.
- Opening a conversation updates the URL based on that conversation's kind:
  `/app/agents/<id>` for Chat sessions, `/app/coders/<id>` for Code sessions,
  and `/app/agent-chats/<id>` for legacy chats. Reload and back/forward restore
  its mode and conversation. Newly created sessions replace their temporary
  URL with the real id without remounting the composer or adding a temporary
  history step.
- **Agents page** (inside the workspace; Settings → Agents is unchanged):
  **Close** returns to the composer. **Agents / Coding agents** tabs split
  the roster into Team and Private, with Edit / Delete actions. The coding
  tab includes runtime setup. The create/edit dialog has sharing, name,
  `@tag`, runtime, default model, connections, channels, and instructions.
- **Session**: the header has the sidebar reopen control, a linked PR status chip,
  favorite, Share, and Side panel. The top-left title uses the same provider icon,
  saved-title precedence, and title menu as `/app/agent/<id>`; click the caret
  beside the title for shared block actions such as Rename, Copy link, Favorite,
  and Delete
  (Rename, Copy link, Delete). A metadata strip lists the agent, runtime,
  model, repository, and status. Chat and Code session inputs
  use the same growing, initially single-line input with the model selector on
  the right.
  Existing sessions retain their agent and kind; use **New conversation** to
  choose another. Stop, queued-message advancement, and quoting remain available.
- Touch devices and users outside the flag retain the Owned / Running / Shared /
  Automations / Skills list. On touch devices, conversation links open standalone
  agent sessions or legacy chats instead of the desktop Agents workspace. A standalone legacy chat is `/app/chat/<uuid>`; doc-scoped chat
  is `/app/md/<doc>/chat/<chat>` (split view).

## Start a standalone chat

While an answer streams, resolved mention pills should keep their names and
icons instead of flashing back to loading placeholders. Check an answer with
multiple mentions while more text arrives and when generation finishes, in both
chat and agent sessions. A newly encountered mention may load once.

On mobile, every screen has a single-line AI composer directly above the bottom
dock. A labeled glass button beside it opens the current view's create action:
**+ Email**, **+ Task**, **+ Document**, **+ Message**, or **+ Event**. Home’s
**+ New** unfolds Email, Message, Document, Event, Task, and More above the button;
More opens the full create menu in a glass bottom sheet. Other views show
**+ New** for that full menu. The AI input narrows to fit the button, ending
to the left of the navigation pill's right edge below. Agents has no separate
create button; its AI input fills the row.
The composer's compact height is 46px, matching the mobile chrome buttons,
with a paperclip attachment control and centered text and actions. It expands for
longer prompts while focused, including text that wraps without an explicit
line break. Lists, blockquotes, headings, and other non-paragraph blocks also
expand while editing, even when their text is short. Shortening a paragraph
draft or widening the pane restores the compact layout when the text fits
beside its controls. Leaving the AI composer collapses a long draft to
a single-line preview in the accessory row; tapping it expands the same editor
with the full draft intact. Screens with an available composer or reply controls show those
instead; opening mobile search shows scope pills in their place. When neither
is available, the AI composer returns with its draft intact, including in
documents without a comment composer. Type a
prompt, optionally choose a model or
attach context, and tap **Send** to create the chat and send its first message.
The paperclip (**Attach files**) opens the device file chooser directly, including
in the native iPhone app; it does not open a Macro file browser. Select supported
files to upload and attach them, or cancel to return to the unchanged draft.
Existing Macro documents can still be attached through an `@mention`.
On touch devices, the accessory hides whenever an editable field outside its
Ask AI composer is focused, including email recipients, subject, and body fields.
It returns with the same draft when focus leaves that field. While typing in
Ask AI itself, the composer stays above the software keyboard; the list reserves
space for it so its last row remains reachable. This also follows focus when a
hardware keyboard is attached.
The area behind the composer is transparent, without a bottom gradient overlay.
The composer has one editable field. Its placeholder appears only while empty;
placeholder updates and disabled-state changes preserve the editor and draft.

Almost every list surface (Home, Agents, Files, Tasks, Customers, Email) has a bottom
composer with placeholder **`Ask AI, @mention anything`**. Click it, `type_text` the message,
press Enter — the app creates a chat and navigates to `/app/chat/<uuid>`. Alternatively,
when `enable-chat-v3-agents` is on (default in dev;
`VITE_ENABLE_CHAT_V3_AGENTS` overrides), `Create` → `Agent`, or keyboard `c`
then `a`, opens `/app/component/agents` with the new-conversation input focused
and ready to type. No session is created until you send a prompt. If Agents is
already open on its roster, the shortcut returns it to the composer; if its
composer already has a draft, that draft stays intact. `C Shift+A` requests a
new split using the standard split-navigation behavior. The shared agent/model
selector and coding repository controls are described above.

## Codex session output

Codex assistant
text appears when the provider supplies a completed message or final snapshot.
Incomplete text fragments are withheld; tool activity and thinking still update
during the turn. Verified Codex PR associations appear as a completed **Found
pull request** activity containing the PR URL, alongside the clickable
PR chip. This reports an existing PR; it does not publish one. Opening a detached
session reads saved history; sending a message reattaches the runtime.
Codex file citations render as inline code with the path and
line range, such as `.gitkeep:1` or `src/main.rs:2-12`; they do not link to a local
file or a guessed remote revision.

## Starting from Home

Home's composer follows the existing `enable-chat-v3-agents` flag: disabled keeps
legacy chat; enabled mounts the same new-conversation composer as the Agents page.
The greeting, agent/model selector, coding repository/branch drawer, and send flow
are shared. Sending opens the new session inside Agents with the matching URL.
Home suggestions and document/project context populate this same draft as markdown
mentions. A failed suggestion conversion preserves the text and shows an error.
Session creation and prompt delivery use the shared pending-session flow.

## Sharing a chat

A standalone chat (`/app/chat/<uuid>`) has **Share** and **Copy Share Link** in
the desktop header; the same **Share** action is on entity list menus and the
entity sharing shortcut. It opens the same Share dialog (mobile: drawer) as
documents:

- People/channels: pick recipients and an access level and send the chat with
  an optional message.
- Link sharing: None / Public / Team link plus an access level.
- **Team access** (owner only, and only when the owner belongs to a team): a
  dropdown with None / View / Comment / Edit that shares the chat directly with
  the owner's whole team. Teammates then open the chat with that level and see
  it under Shared; setting it back to None revokes that access. This is
  independent of the team-scoped link control. Only the chat's actual owner can
  change it; someone with inherited owner access gets a "Failed to change team
  access" toast.

## Start a doc-scoped chat

Open a doc → side panel `Actions` → `Ask Macro`. Opens a chat pane with the document already
attached as context (it appears as a link chip in the composer). New-chat pane shows tips:
`@mention anything` to attach entities, `Ctrl+Enter` to send in the background (you get
notified when the AI responds). Legacy Home background sends preserve the submitted tool selection.

## Composer anatomy (a11y)

Desktop composer and conversation body text use 15px type. Mobile keeps its
existing text sizing.

- Contenteditable composer (placeholder `Ask AI, @mention anything` / `Describe the edit…`).
- Model picker button showing the current model (e.g. `Haiku 4.5`).
- `Send` button (disabled when empty). While streaming it becomes `Stop generating`.

On desktop, production AI, new agent, and channel composers use 28px circular
send/stop buttons with a neutral contrast fill (white in dark themes). The outer
corner radius is 22px, matching the 14px button radius plus its 8px inset.
Expanded/multiline desktop AI text gets an extra 8px of left padding; toolbar
positions and single-line text spacing stay the same. Desktop composers have
an additional 2px of space below them; mobile dock spacing is unchanged.

On mobile the production AI, new agent, and channel composers share rounded
glass chrome, text padding, and a footer toolbar with a circular Send button.
The production AI composer has an `Attach files` paperclip, `Ask AI…` placeholder,
and compact model picker. On desktop, `Attach files` opens the file picker directly; use `@` to reference existing workspace items. Both AI systems keep model selection in the toolbar
and expand with longer drafts. The new agent editor supports context via `@`
mentions; its existing attachment capabilities are unchanged. Stop and queued
message controls remain available.

User messages in both AI systems appear in right-aligned bubbles with rounded
corners, including on mobile. In dark mode, their fill and text follow the active
theme; Macro Dark uses a dark gray fill and white text. Long prompts wrap within the bubble;
production chat retains its Show more/Show less and editing controls.

## Waiting for a response

On desktop, email drafts embedded in chat use the same rounded, elevated surface
as email blocks: an opaque background, subtle border and shadow, and a raised
rim in dark mode. The recipients, subject, body, and send controls stay inside
that card. Touch-device styling is unchanged.

The reliable completion signal is the disappearance of the `Stop generating` button — poll
with `evaluate_script`. Do not wait on response text: the page displays
`Time to first token: N s` and doc content that easily false-matches `wait_for` patterns.
After completion, each assistant message gets `Edit assistant response in Notes` and
`Copy assistant response` buttons; tool-use turns render as an expandable `N steps` button.
The chat auto-titles itself after the first exchange (route stays stable, title changes).

The agent has workspace tools (it can list your documents, read channels, create tasks,
render `displayResults` views). Requests go to `POST /cognition/stream/chat/message`; results
stream over the app's websocket, not the HTTP response.

## Agent sessions asking a question

For manual testing on local or deployed development environments, send
`/ask <question>` for free text or `/ask <question> | option | option` for a
single choice. This shortcut bypasses the model. It is disabled in production,
where the text is an ordinary prompt; the model's `AskUser` tool and user-tool
review remain independent of this development setting.

An agent session (the `/app/channel/<channel>/agent/<session>` pane) can pause its turn to
ask you something. A card titled `<bot> is asking` with trailing text `Waiting for you`
appears in the transcript, and the notice `The agent is waiting for your answer above` sits
over the composer. Forms have one control per field (radios for a choice, an `Other` text
box when the agent allows a custom answer, checkboxes for multi-select, text/number inputs)
plus `Submit` / `Decline` / `Cancel`; a link request shows the target host and URL with an
`Open` button that only opens a new tab after you click it. Once answered the card collapses
to `Question · <text>` with `Answered` / `Declined` / `Cancelled` on the right and the agent
continues. Messages typed while a question is open queue behind it; the composer's `Stop`
square cancels the question and the turn. Anyone with edit access to the session may
answer; viewers see the form locked with `Waiting for an editor`. The owner and everyone
who has prompted or answered the session also receive an `agent_session_waiting_for_input`
notification (inbox, browser, and iOS push) when the question is asked; it stays until
marked done.

## In channels

Mention `@Macro` in any channel message for the classic in-channel reply. Mention
`@macro-new` (or `@coder` / `@cursor`) to open an **agent session** — a dedicated
transcript at `/app/agent/<uuid>` whose replies also stream back into the thread.

## Agent sessions

An agent session is `/app/agent/<uuid>`. The composer placeholder is
**`Message the agent, @mention anything`**. Creating one (`c` then `a`, or
`Create` → `Agent`) leaves that composer focused — on mobile that is the same
Create-menu `triggerFocusInput` as chat, so the keyboard opens. Type `/` to
open slash commands the connected agent advertised (Claude, OpenCode, and
Cursor). `/` stays ordinary text until that list arrives. Type `@` to insert the same mention chips
used in chat and channels; they serialize as mention-chip tags in the prompt
the agent sees (`<m-document-mention>` for docs/channels/chats/tasks/emails/calendar
events/skills, `<m-date-mention>` for a day or time, `<m-agent-session-mention>`
for an agent session, `<m-user-mention>` for a person, and the other chip tags).
Agent replies that emit those tags render as clickable chips in the
transcript (and in the originating channel thread). An agent-session chip with
`"expanded":true` renders as the Magic Chip card that follows the session's
latest turn.
`@mention` a person in a prompt and, if you can edit the session, they are granted edit
access and get an `agent_session_mentioned` notification that opens the session; a viewer's
mention only notifies people who could already open it.

In Home, a new Agents conversation, and an existing agent session, files can be
attached to a prompt three ways: drop them anywhere on the composer (a
"Drop files here to send them to the agent" overlay appears), paste them from the
clipboard, or use the paperclip **`Attach files`** button. Every file uploads to the
static file service and shows as a chip above the text (media thumbnails, document
pills with a remove `×`); **Send** is disabled while an upload is pending. The agent
receives each file as an ACP `resource_link` (a URL it can fetch) after the prompt text,
and the sent prompt renders its files in the transcript (image thumbnails and
video previews that open the same lightbox as channel media; file chips that
open the file). A prompt may be files only, including the
first message in a new conversation. Uploading attachments survive switching the
agent or opening repository settings; sending clears the attachment previews.
Queued prompts
list their attached file names under the text; editing a queued prompt keeps them.

Cursor walkthrough files the run re-hosts appear in the transcript after the
answer: screenshots as images, recordings as video players, and `.txt` / `.log`
files as an inline `txt` code block (not a download link). Larger or non-UTF-8
text stays a link.

On mobile the composer (and any queued prompts above it) floats in the bottom
accessory region above the dock — same placement as channel and AI chat — so it
stays tappable and clear of the home indicator. The box is full width; the text
sits on top and a footer row holds the model name (left, e.g. `Auto ⌄`) and
**Send** (right). Tapping the model name opens a bottom sheet listing every
model with a check on the current one — pick a row to switch. On desktop the
transcript and composer use the shared channel message width so expanding **Context** only
grows vertically; your messages are right-aligned bubbles and the model pill
sits above the box. Tap the session title
to open the title menu (caret), then **Rename** — that opens the generic entity
rename dialog. Do not expect a tap on the name itself to start
an inline edit.

When the session has opened a pull request, a compact `#N` status chip
appears in the header (top right) and in the side-panel Details. Click it
to open the PR entity in a split; until GitHub has synced the entity the
chip is a GitHub link instead. The icon and status word follow open /
merged / closed.

Tool groups and individual tool cards start collapsed. Expand a group to see
its calls, then expand an edit card to view its file diffs. Diff bodies load
only when their card opens; syntax highlighting may appear after the diff text.
Opening a session or expanding a group should leave the app responsive, even
when the session contains many file edits.

A thought row reads **Thinking** and shimmers only while it is the last part
of the turn the session is working on. Earlier thoughts settle to **Thought**
as soon as a tool or answer follows, including during long Cursor turns. A
trailing thought stays outside the tool group so the live reasoning row stays
visible. Only the newest turn can be live: once the composer stops showing the
agent as working, every Thinking label, **Calling N tools** row, shimmering
tool title, and working row settles — earlier turns never shimmer, even ones
the runtime cut off mid-call. At most one shimmering row is ever expected.

### Sharing a session

In the Agents workspace, saved sessions use the shared top-bar controls: session
icon, title and action menu, Share, Copy Share Link, and a side-panel toggle.
There is no breadcrumb because Agents has no subspaces. Unknown model providers
fall back to the chat icon. The toggle (or `]`) opens the session's Details, Plan,
Changes, and Activity sections when available, beside the transcript in wide
layouts or over it in narrow layouts; it does not open another split.
New conversation pages have no disabled session action buttons. Older chats
also have one header row, and empty chats show a simple conversation prompt
instead of the standalone recent-sessions and tips surface.

Saved sessions have **Share** and **Copy Share Link** in the desktop header;
on mobile, open the session title menu and choose **Share**. The owner can
select people or channels and send the session with an optional message using
the same Share dialog and mobile drawer as documents. Sessions also support
**Share** from entity list menus and the entity sharing shortcut. People receive it through a direct or
group message. Recipients can view and control the session; there is no access
level selector. Cancel closes the composer without sending.

Other participants can copy a link for people who already have access, but
cannot grant access. Copying a link alone never changes permissions. New,
unsaved session drafts do not offer sharing.

Agent sessions in the `@` menu use the shared Quick Access feed, loaded when the app opens. Search matches session titles and agent names. The initial feed covers the 500 most recently updated accessible sessions; it does not load transcripts.

### Expanded session mentions

Hover an accessible inline `@` session mention in an editable document or
composer and choose **Convert to Card View**. The card is the same Magic Chip used
for agent responses and follows the session's latest turn as it streams. Use
**Collapse to mention** in its header to restore the compact underlined title.
The display choice survives reload and copying; expansion still references the
same session and does not invoke a bot. Compact mentions do not load transcripts.
Existing announcement chips remain locked to the turn they announced.

### Reviewing a linked GitHub pull request

Sessions with a linked GitHub pull request capture that PR's diff when each
turn ends, regardless of the agent runtime. Unpushed workspace changes and
branches without a PR are not included. The session header gains a **Changes**
toggle (`aria-pressed`) with green additions and red deletions (`+N −M`); it opens a resizable
**Changes** pane beside the transcript (drag the 1px divider between them).
The URL's `diff` query parameter stores each session's pane state and diff
layout (`session-id:split:unified`, or `changes-only` / `agent-only` and
`split` for side-by-side diffs). Copying the URL preserves that view; reload
and Back/Forward restore it. A plain session URL starts with Changes closed.
Divider width, collapsed files, and review notes stay local.
The pane header shows a `head → base` branch pill, a **Unified / Split**
segmented control (`aria-label="Diff layout"`), a refresh button, the
**View pull request** button (opens GitHub), and **Expand changes to the full width**
(spotlight; **Bring the session back** returns to the split) and **Close the
changes pane**. Below it is a **Collapse all / Expand all** button.
The body is a file tree (`nav[aria-label="Changed files"]`, directories
compressed along single-child chains, status letters A/M/D/R and +/− counts)
next to a scrollable stack of file cards. Expanded cards keep their full height;
**Collapse all / Expand all** hides or restores their bodies. Each card's header has a disclosure
caret, the path, `+adds −dels`, and **Copy path**. Diffs render with Pierre; hover a
line and click the accent **+** in the gutter (drag for a range) to leave a
review note for the agent (`aria-label="Review note"`; `Cmd/Ctrl+Enter` adds,
`Escape` cancels). Notes hang under their line as "queued for the agent" and a
**N review notes queued · Send to agent** chip appears above the composer.
The chip's count row expands (`aria-expanded`) to show each queued note's
file, line, and text so the reviewer can read or edit them before sending;
**Send to agent** then posts one prompt listing every non-empty note by file
and line and marks them "sent to agent". Clicking a note's path opens that
file in the Changes pane. Notes never go to GitHub. Collapsed files and
unsent notes persist per session in localStorage; a new capture expands all
files.

While the pane is closed and a capture has files, a **Changes ready to
review** card sits above the composer with **Review changes**, **Pull request
#N** (opens GitHub), and **Dismiss**. With no linked PR, the pane explains
that a GitHub PR is required. Ask the agent to open one and register its URL
with `set_pull_request`, then use **Refresh changes**. An unavailable or
oversized PR is explained in the pane; there is no branch or container fallback.
Refresh request failures show a retry banner while keeping the last diff visible.
The pane does not create PRs or generate their descriptions.

### Transcript navigation

Agent sessions reuse the channel's TanStack `ThreadList`. Opening a session lands
at the latest message, including when history arrives after the empty view. Short
transcripts sit at the bottom, above the composer. Only the visible rows and an
overscan buffer are mounted: scroll to older turns before searching their DOM text.

Search links add `agent_message_turn=<zero-based turn>&agent_message_author=user|agent`.
They wait for history to load, then scroll to and highlight the matching folded
message instead of staying at latest. Clicking another hit (including in an already
open session) repeats the jump. Manual navigation or **Scroll to bottom** clears the
message highlight; incoming output does not repeat the search jump.

- New messages and growing streamed replies follow while within 50px of the end.
  Scroll up to read history without being pulled back by subsequent output.
- Far above the end, scroll downward to reveal **Scroll to bottom**. Clicking it
  returns to latest and resumes following. The right-edge custom scrollbar is also
  drag-seekable, like channels.
- Select mounted transcript text to use **Reply to selection**. Streaming updates
  retain message-row identity; scrolling a row outside the virtual window can
  unmount it, so finish selecting/quoting before navigating far away.
- On mobile, messages scroll behind the floating header and composer. Their insets
  are included in list measurements. Keyboard show/hide and composer/queue height
  changes keep latest visible only if the reader was already pinned.

Regression check: open a long session, let a reply stream while at latest, then
scroll several screens up and confirm output does not pull you down. Scroll down
to reveal the overlay and return to latest. Repeat with a short session and on a
physical phone while opening/dismissing the keyboard, both at latest and in history.

When a session reconnects using ACP load, the last committed conversation stays
visible while history is reconstructed. A successful load replaces the transcript
once, including prompts, thoughts, and tool results; it does not append another
copy. Replayed rows can change content type under existing message or tool IDs;
the live transcript must show the new content without an error or a reload.
A failed or interrupted load leaves the previous conversation visible, and
late replay notifications remain hidden across initialization/reconnect markers
until a valid session open or dispatched prompt establishes live traffic. Reopening
the session shows the same committed history. Initialization, creating a session, and ACP resume do
not by themselves clear existing messages. Channel agent-reference previews follow
the same replacement behavior. Every successful load can replace history with an
empty transcript, including historical lookup-only Cursor load acknowledgments.
If a load finishes while the browser
is fetching history, buffered content from before the selected history boundary
must stay hidden; subsequent live messages must still appear.

### Sending and queueing

- Sending is never blocked by a running turn. A prompt sent mid-turn is queued
  **server-side** and dispatches automatically when the current turn ends, one per turn.
  The queue holds at most 50 entries; past that a send is refused with an error rather
  than queued.
- Queued prompts render as a list between the transcript and the input, newest at the
  top — the prompt about to be sent sits at the bottom, immediately above the input.
  Each row shows a `Queued` label (with `by {user}` when someone else queued it —
  several users can stack prompts in one session's queue) and an always-visible remove
  (`X`) button. A queued prompt's text is itself an editor: click in and type — changes
  autosave (debounced, and on blur) with no save button. Editing and removal are
  possible only until the entry dispatches; after that the row simply becomes the next
  user message in the transcript.
- Keyboard: Up at the very start of the composer input moves focus into the
  bottom (next-to-send) queue row; further Up presses walk toward newer entries, Down
  walks back and past the bottom row returns to the input. When the composer is empty
  and a prompt is queued, its action becomes `Send next queued message` (an Enter
  symbol); pressing Enter or clicking that button cancels the current turn so the next
  queued prompt starts immediately. Typed composer text still takes priority and Enter
  queues that new prompt normally.
- The stop button cancels only the **current** turn. The queue keeps draining: the next
  queued prompt starts a new turn. To fully quiesce a session, remove the queued
  entries, then stop.
- **Permission prompts.** Everyone with **Edit** access to a session may approve or
  reject its ACP permission requests, even when they did not create the session.
  A pending request shows one `Approval needed` card above the composer, with
  the command or affected file separate from the actions. The transcript does
  not repeat the pending request.
  `Allow once` and `Deny` answer immediately; `More options` contains remembered
  choices with the agent's full rule text. Channel Magic Chips expose the same
  approval card in place of their loading state, alongside existing questions.
  Only authenticated users with **Edit** or **Owner** session access may answer;
  bot, harness, and internal-service credentials cannot approve on their behalf.
  Viewers and commenters see a waiting notice without
  action buttons. Stopping a turn cancels open requests; answered requests show
  a compact outcome such as `Allowed once` or `Denied` in the transcript.
  Permission requests and questions both put the agent in a waiting state.
  Several permissions may be pending alongside one question; answering one leaves
  the others available. Controls disappear when their turn ends, is stopped, or
  disconnects, and old transcript requests cannot answer a later turn's request.
- **Harness bypass consent.** Settings → Harnesses → Connect a harness offers
  `Allow bypassing permission requests`, off by default. Enabling it warns that
  agents may run commands and edit files on the machine without approval.
  Macrod Quickstart and Config also offer `Full Access`, off by
  default. The choice applies at the next pairing: off disables bypass in the
  approval dialog; on preselects bypass with a warning, and the approving user
  can turn it off. Older daemons leave this choice to the approval dialog.
- **Agent permission policy.** Settings → Agents → Runtime shows `Always prompt`
  and `Always bypass` only for local macrod harnesses. Macrod defaults to prompts;
  bypass requires both harness consent and the agent's explicit choice. Built-in
  Macro, in-memory, Cursor, Codex, and Claude runtimes always bypass and have no
  permission policy selector. The backend enforces these policies.

Locally sent user messages in both AI implementations enter with a short upward
slide and fade. History and remounted messages stay
still; reduced-motion preferences disable the transition.

On phones, the chat model control appears as a provider icon while the software
keyboard is open. Its accessible name is `Choose model, <model name>`. It opens
a `Select model` sheet with descriptions, a checkmark for the current choice,
and a **Done** button. Selecting an available model updates the selection;
locked models open the upgrade flow. The sheet stays open when the keyboard closes.

The compact model menus use the standard menu text size and a 240px width
(capped to the viewport), consistently in production chat and the agent input.

Chat title icons follow the selected model's provider, including the agent
system's live model. Soup rows use the model included in the list data, with a
saved local draft selection taking precedence. Icons do not query chat transcripts.
Rows without model data show the standard chat icon. Claude models use the Claude sunburst logo; OpenAI and Google use their
provider logos; unknown providers in chat titles reserve the icon space.

For a Macro agent session, changing the model must settle on the selected model
and update the title's provider logo. Check this with an OpenAI override when
starting a session and when changing an existing session before its first prompt.
Reopening or resuming the session must retain that selection and logo.

Both AI composers display their model trigger label at the input text size
(15px), using the softer secondary text color. This includes the agent model
catalog trigger and mobile model sheet trigger. Opening the agent model
catalog focuses the `Search models` field so you can type immediately.
The search field is borderless inside the menu. New-session and active-session
model triggers use a transparent round pill with a background only on hover,
15px icons, and compact spacing,
matching the production chat composer's proportions.

Soup and recent-chat icons recognize the provider in the saved model ID even
when that model is no longer selectable. For example, `openai/gpt-5.5` retains
the OpenAI logo; an unknown provider shows the standard chat icon instead of
defaulting to Claude. A recognized per-chat selection takes precedence over the
server model. New sends record that selection before navigation or a background
send, so list icons can update immediately. Restoring a draft without a valid
model lets the composer use the chat's saved model before applying its default.

Agent header PR chips resolve their GitHub URL once and receive saved PR metadata
through connection gateway. A newly opened PR can remain unresolved until its
webhook sync completes; its chip should then appear without a page refresh.
Verify status changes (open/merged/closed) while the chip stays mounted, and
verify that reconnecting the gateway catches up changes missed while disconnected.
There is no periodic PR lookup polling.
