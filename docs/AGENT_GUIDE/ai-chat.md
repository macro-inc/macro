# AI Chat (Agents)

## Where chats live

- List: `Go to Agents` → `/app/component/agents`, tabs Owned / Running / Shared /
  Automations / Skills. Existing chats are listed by auto-generated title.
- A chat is `/app/chat/<uuid>`. A doc-scoped chat is `/app/md/<doc>/chat/<chat>` (split view).

## Start a standalone chat

Almost every list surface (Home, Agents, Files, Tasks, Customers, Email) has a bottom
composer with placeholder **`Ask AI, @mention anything`**. Click it, `type_text` the message,
press Enter — the app creates a chat and navigates to `/app/chat/<uuid>`. Alternatively
`Create` → `Agent A`, or keyboard `c` then `a`, opens a managed agent session
directly at `/app/agent/<uuid>` (the runtime starts while the block mounts).
That create path focuses the agent composer so you can type immediately.
When the `enable-agent-session-composer` flag is on (default in dev;
`VITE_ENABLE_AGENT_SESSION_COMPOSER` overrides), the same entry instead opens
the **Start a session** composer popover. A centered title sits above two rounded
boxes of equal width: a shallow agent strip and a prompt box about twice its
height, separated by a small gap. The picker has
compact choices in a horizontally scrolling `radiogroup` (`aria-label="Agent"`,
`aria-orientation="horizontal"`, `role="radio"`, `aria-checked`). All agents are
available by scrolling sideways, with recent successful choices first.
An accent **Create agent** button stays fixed to the right of the strip.
It closes the session composer and opens the new-agent form at
`/app/settings/agents?createAgent=true`; it does not create a session.
Recents are remembered per user on this device. With no history, **Macro**
`@macro` (the default) and **Cursor** `@cursor` lead, followed by saved agents.
Without a connected Cursor API key, Cursor is a **Connect Cursor** button:
clicking it closes the composer and opens Settings → Harness without creating
a session. It is keyboard-accessible; arrow navigation focuses it without
activating it. Connected Cursor remains a selectable agent. Setup navigation
is disabled while a session is being created or its setup is being retried.
Each row shows its `@handle` beneath the name. There are no coding tags;
default models appear only in the prompt's model selector.
There is no search field or browse/expand control. Left/Right change the selected
agent and scroll it into view; Home/End jump to the first/last available agent.
Unavailable agents without a connection action are skipped.

The prompt box uses the agent session composer's surface, regular message text,
and arrow send button, with a three-line editing area. It names the
current selection:
`What would you like Macro to work on?` becomes
`What would you like Cursor to work on?` when Cursor is selected. Its aria-label
is `Task for the agent`. The dialog's default autofocus lands on the selected
agent row, its first tabbable control.
The prompt and agent strip share the same surface layer and background.
A centered caption below the prompt describes the selected runtime: Macro
shows “Starts quickly and runs in-memory. Great for workspace tasks”; Cursor
shows “Bring in Cursor for some heavier coding work”. Local-connector agents
are still excluded from creation by this modal's managed-session endpoint.
The **Model override** selector (`aria-label="Model override"`) sits inside the
prompt box at the bottom left. It
shows `default (<model name>)` when using the agent's configured default and
the model name alone when overridden. It has no model icon. Saved-agent defaults
come from their configuration; built-in defaults are loaded from model discovery.
While a default is unknown, the selector reads `default`. Changing agent resets
the override. Tab order is selected agent row (and any connection action) →
**Create agent** → prompt → model → **Start session**.
Escape in the prompt first blurs to the dialog; a second Escape closes it.
Press the arrow send button (labelled **Start session**) or `Cmd/Ctrl+Enter`;
the button shows a spinner and is labelled **Starting…**
while the server creates the session, applies the model override, and accepts the
first prompt. It then closes
and opens the real `/app/agent/<uuid>` URL. It never navigates to a temporary
`pending-…` URL. Creation failures keep the prompt in the modal and show **Retry**.
If model setup or prompt delivery fails after creation, **Retry** reuses that
session, and **Open session** opens it directly; agent and model selection stay
locked to the session already created.
Leaving Macro selected uses the backend's in-memory default in every
environment, including production; it does not provision a Daytona container.
Explicit coding-agent selections still use their configured runtimes.

## Start a doc-scoped chat

Open a doc → side panel `Actions` → `Ask Macro`. Opens a chat pane with the document already
attached as context (it appears as a link chip in the composer). New-chat pane shows tips:
`@mention anything` to attach entities, `Ctrl+Enter` to send in the background (you get
notified when the AI responds).

## Composer anatomy (a11y)

- Contenteditable composer (placeholder `Ask AI, @mention anything` / `Describe the edit…`).
- Model picker button showing the current model (e.g. `Haiku 4.5`).
- `Send` button (disabled when empty). While streaming it becomes `Stop generating`.

## Waiting for a response

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
Create-menu `triggerFocusInput` as chat, so the keyboard opens. Type `@` to insert the same mention chips
used in chat and channels; they serialize as `<m-document-mention>` tags in the prompt
the agent sees. Agent replies that emit those tags render as clickable chips in the
transcript (and in the originating channel thread).
`@mention` a person in a prompt and, if you can edit the session, they are granted edit
access and get an `agent_session_mentioned` notification that opens the session; a viewer's
mention only notifies people who could already open it.

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

### Sharing a session

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

Agent sessions in the `@` menu use the shared Quick Access feed, loaded when the app opens. Search matches session titles and persona names. The initial feed covers the 500 most recently updated accessible sessions; it does not load transcripts.

### Expanded session mentions

Hover an accessible inline `@` session mention in an editable document or
composer and choose **Convert to Card View**. The card is the same Magic Chip used
for agent responses and follows the session's latest turn as it streams. Use
**Collapse to mention** in its header to restore the compact underlined title.
The display choice survives reload and copying; expansion still references the
same session and does not invoke a bot. Compact mentions do not load transcripts.
Existing announcement chips remain locked to the turn they announced.

### Transcript navigation

Agent sessions reuse the channel's TanStack `ThreadList`. Opening a session lands
at the latest message, including when history arrives after the empty view. Short
transcripts sit at the bottom, above the composer. Only the visible rows and an
overscan buffer are mounted: scroll to older turns before searching their DOM text.

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
