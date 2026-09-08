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
the **New agent session** composer popover. The prompt textarea (`Give your agent a
prompt...`) is focused on open, so you can `type_text` immediately. Below the prompt a
**Agent** section (`aria-label` `Agent`) lists the choices in the open, as a
`radiogroup` of cards (`role="radio"`, `aria-checked`): **Macro** `@macro`
(the default), **Cursor** `@cursor` (disabled with a `Connect Cursor in
Settings → Harness` hint until a Cursor API key is stored), then the user's
own agents, each card showing avatar, name and `@handle · Macro|Cursor` for
the runtime (a disabled card reads `@cursor · Not connected`). Every agent is
shown; the cards form an even grid that fills the popover width. Click a card
or use arrow keys to change agent. The **Model
override** pill (`aria-label` `Model override`) at the bottom left opens a
menu whose first row is `Agent default · <model>`, followed by at most five
featured models; longer catalogs put the rest under a `More models` submenu.
Changing agent resets the override. Tab order is prompt → selected agent card → Model →
**Create Session**; the close `X` is skipped. The menu opens on Enter/Space
and selects with arrow keys + Enter. Escape in the prompt first blurs to the
dialog, a second Escape closes it. Press **Create Session** or
`Cmd/Ctrl+Enter`; the composer closes and the new `/app/agent/<uuid>` session
opens while its runtime starts.

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

On mobile the composer (and any queued prompts above it) floats in the bottom
accessory region above the dock — same placement as channel and AI chat — so it
stays tappable and clear of the home indicator. The box is full width; the text
sits on top and a footer row holds the model name (left, e.g. `Auto ⌄`) and
**Send** (right). Tapping the model name opens a bottom sheet listing every
model with a check on the current one — pick a row to switch. On desktop the
transcript and composer use the shared channel message width so expanding **Context** only
grows vertically; your messages are right-aligned bubbles and the model pill
sits above the box. Tap the session title
to open the title menu (caret), then **Rename** — that opens the same style of
rename dialog automations use. Do not expect a tap on the name itself to start
an inline edit.

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
