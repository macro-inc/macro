# AI Chat (Agents)

## Where chats live

- List: `Go to Agents` → `/app/component/agents`, tabs Owned / Running / Shared /
  Automations / Skills. Existing chats are listed by auto-generated title.
- A chat is `/app/chat/<uuid>`. A doc-scoped chat is `/app/md/<doc>/chat/<chat>` (split view).

## Start a standalone chat

Almost every list surface (Home, Agents, Files, Tasks, Customers, Email) has a bottom
composer with placeholder **`Ask AI, @mention anything`**. Click it, `type_text` the message,
press Enter — the app creates a chat and navigates to `/app/chat/<uuid>`. Alternatively
`Create` → `Coding Agent A`, or keyboard `c` then `a`.

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

An agent session (the `/app/channel/<channel>/agent/<session>` pane) can pause its turn to
ask you something. A card titled `<bot> is asking` with trailing text `Waiting for you`
appears in the transcript, and the notice `The agent is waiting for your answer above` sits
over the composer. Forms have one control per field (radios for a choice, an `Other` text
box when the agent allows a custom answer, checkboxes for multi-select, text/number inputs)
plus `Submit` / `Decline` / `Cancel`; a link request shows the target host and URL with an
`Open` button that only opens a new tab after you click it. Once answered the card collapses
to `Question · <text>` with `Answered` / `Declined` / `Cancelled` on the right and the agent
continues. Messages typed while a question is open queue behind it; the composer's `Stop`
square cancels the question and the turn.

## In channels

Mention `@Macro` in any channel message for the classic in-channel reply. Mention
`@macro-new` (or `@coder` / `@cursor`) to open an **agent session** — a dedicated
transcript at `/app/agent/<uuid>` whose replies also stream back into the thread.

## Agent sessions

An agent session is `/app/agent/<uuid>`. The composer placeholder is
**`Message the agent, @mention anything`**. Type `@` to insert the same mention chips
used in chat and channels; they serialize as `<m-document-mention>` tags in the prompt
the agent sees. Agent replies that emit those tags render as clickable chips in the
transcript (and in the originating channel thread).

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
  walks back and past the bottom row returns to the input.
- The stop button cancels only the **current** turn. The queue keeps draining: the next
  queued prompt starts a new turn. To fully quiesce a session, remove the queued
  entries, then stop.
