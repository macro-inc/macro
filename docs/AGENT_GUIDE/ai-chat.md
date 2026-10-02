# AI Chat (Agents)

User-sent messages in chat and agent transcripts use an ink-colored bubble with
`InvertUtil` in light themes. Dark themes use `Layer depth={3}` for the slightly
lighter bubble with the normal text palette. Preview Markdown and controls at
`/app/debug/ui?ui=invert-util` under **User-sent AI message**.

## Working with projects

Project tools can list, read, create, update, delete, and share projects; set or
clear task associations; and read project activity. Backend tool names use
`Initiative`. These operate on the native Projects views in Tasks.

Each completed tool row has an expandable result toggle, including empty results
and per-task failures. Project chips open the native project. Shift-click opens
another split. **Result data** reveals the complete returned response. Successful
mutations refresh the project views.
Deleting a project shows its result without a link to the deleted project.
Failed project deletions show `Not deleted`. Clearing projects from several tasks
reports each task's outcome, including partial failures.

## Phones with new agents enabled

With `enable-chat-v3-agents`, **Agents** opens the new conversation list on phones,
including GitHub PR state and links. Tap a row to open a full-screen conversation;
the header back button returns to the previous screen, or Agents for a direct link.
Portrait and landscape touch layouts have no conversation side panel. **Changes** opens a full-width,
unified diff with **Back to conversation**; returning preserves the unsent draft.

The mobile conversation list omits the desktop **New conversation**, **Agents**,
and **Connections** controls. Use the Home composer or global create menu to start
a conversation. Returning to the list and reopening the composer preserves the
draft, attachments, agent, model, repository, and branch. Tap the
agent/model control to open a searchable bottom sheet. Tap an agent to use its
default model, or its model arrow to choose a model; **Create agent** opens the
roster. Desktop navigation remains unchanged.

The mobile Home composer is a filled, rounded input with no placeholder or
rotating tips. Its collapsed height matches the New button, with the model
selector and Send always visible. Tap the input to reveal attachment, microphone
(when enabled), and repository controls; they collapse again when tapping outside.
The editor and model picker stay mounted so collapsing preserves the draft.
Repository and branch pickers keep the composer expanded while their search
fields are focused, so their anchor stays in place.

With the flag enabled, Home/list composers, search, the create menu, folder AI
creation, contextual **Chat with AI**, and onboarding prompts all start new agent
sessions. Existing legacy chat rows still open their original chats. Contextual
chat actions use agent sessions regardless of the flag; without the flag, the
legacy list and flag-gated composer flows remain available.

While an agent works, a draft can be sent to its queue. Above the queue,
**Send next** explicitly interrupts the current turn and sends the oldest queued
message. The empty composer offers the same action when messages are queued;
with a draft it offers **Send**. With no draft or queue, the busy composer offers
**Stop**. Send-next actions disable during stopping/starting and for read-only
sessions.

Phone verification: check portrait and landscape with touch emulation. In the
Home composer, enter multiple lines and tap Send, attach, or the model control;
blurring the editor during the tap must not collapse or move the controls. Then exercise
list → new conversation → back → new conversation, a row and direct session link,
the model sheet and repository controls, queued sends, and Changes → back. Check
that composers remain above the keyboard and neither Changes nor headers cause
horizontal overflow.

## Uploading files with AI

`UploadFile` accepts a filename and standard padded base64 contents, up to 25 MiB
decoded. An optional project ID places the file in a folder the caller can edit.
Use `CreateDocument` for generated text and native Macro spreadsheets. Agents with
code execution should construct the base64 argument from the original bytes;
the tool cannot access an agent's local path or download a URL.

The tool row displays the filename and, on success, **Uploaded**. Expand it to
open the created document and see the uploaded byte count. Success means the
bytes reached storage; previews, DOCX conversion, Markdown initialization, and
indexing may finish asynchronously. Invalid contents, oversized files, and folder
permission failures should display a failed tool call without a successful result.

## Generating images with AI

`GenerateImage` takes a text prompt, renders it with Google's Nano Banana image
model, and saves the result to static file service. An optional aspect ratio
(`square`, `landscape`, `portrait`, `widescreen`, `tall`) controls its shape.
The response includes `staticFileId` and the permanent image `url`; it does not
create a document or take a filename or destination project.

For edits or variations, attach photos with the existing paperclip or use Macro
image documents the user can view. Pass up to three references in `referenceImages`,
for example `[{"type":"staticFile","id":"<UUID>"},{"type":"document","id":"<UUID>"}]`.
For an uploaded photo, use the UUID from `/file/<id>` in its attachment URL;
for a document, use its document ID. Describe the edit in `prompt`, referring to
image 1, image 2, and image 3 in array order. A description alone does not send
the photo to the image model. For a previous generation, use its `staticFileId`
with type `staticFile`. Each result is saved as a new static file.

The result appears directly as an image outside grouped tool calls, loaded from
its SFS URL without a filename header or document navigation. It preserves its
aspect ratio and fits the available width. A status appears while generation is
pending; a failed image load shows “Preview unavailable”. The tool already renders
the result in chat, so the assistant should not add a document mention or duplicate
image there. In channel messages, embed the returned URL as a Markdown image.
Earlier generations saved as DSS documents still render their original document
card when viewing historical conversations.
Refused prompts, provider failures, and hosts without a Google Generative AI key
display a failed tool call; the error tells the agent whether to rephrase, retry,
or stop.

## Ask AI entry points

**Ask AI** in search (including Tab), the command menu, and mobile search opens
an agent session. A nonempty search query is sent as the first prompt once the
session is ready; an empty search opens an empty composer. Desktop search replaces
its current split, while command-menu and mobile actions open a new split.

**Ask Macro** and **Chat with Agent** on documents, PDFs, spreadsheets, email,
channels, calls, and projects also open agent sessions. Their entity mention stays
in the composer as an unsent draft. Spreadsheet mentions retain the current sheet
and selected range; channel-message actions retain the referenced message.
Add a question and press Send to submit that context. These actions do not create
legacy cognition chats, regardless of the Agents workspace feature flag.

## Where chats live

The Agents conversation list shows row skeletons after a short delay on first
load. Fetching another page appends three placeholders while existing sessions
remain usable. Wait for named conversation buttons before selecting a session;
the placeholders are decorative and cannot be focused. Reduced motion disables
the shimmer.

- If session creation fails, the session view shows **Unable to start this agent**
  with the service's reason. Repository access requires a GitHub connection to
  Macro that covers that repository; connecting only Cursor does not grant Macro
  GitHub access. Cloud agents also need a public agent gateway: Docker-only hostnames
  cannot receive their MCP callbacks. Check the runtime error before retrying, and
  start a new Claude session after correcting its gateway network configuration.

- Open **Go to Agents** → `/app/component/agents`. With AI agents enabled
  (`enable-chat-v3-agents`), the workspace uses one sidebar for Chat and Code.
  Below **New conversation**, **Agents** opens the same roster as the composer’s
  **Create agent** action. **Connections** manages MCP integrations (including
  app authentication and disconnection); this section has moved out of Settings.
  Home’s **Connect your tools** and agent replies’ **Connect app** chips open this
  Connections page. Personal Gmail/GitHub account links remain under Settings →
  Integrations.
  **New conversation** opens the composer. **Conversations** is a mixed list
  of chats and coding sessions, newest first, with one search across both.
  Chat rows use a chat icon; coding rows use `</>` (the PR status icon when a
  pull request is linked). Home and the Agents sidebar share these agent rows.
  Rows have no agent or runtime-status subtext. A session that is starting or
  whose turn is still running (the agent is working, writing code, or stopping)
  shows the same three-dot working wave as the transcript in place of the
  leading icon; the row's accessible name appends `Starting` or `Working`.
  Sessions with a linked PR show
  **#<number>** beneath the title (icon colored by open / merged / closed; no
  status word). Clicking it opens the synced
  GitHub PR entity in a split (the same destination as the session header chip
  and Magic Chip). A synced PR opens at `/pr/<foreign-entity-id>`; existing
  inline previews retain their legacy block host. Until GitHub has synced the
  entity it opens GitHub in a new tab. Either click leaves the session unopened.
  Changing the composer mode does not filter the sidebar.
  Selecting a row opens its own mode; Shift-click opens it in a new split.
  Right-click (or long-press on mobile) opens the same entity menu as Home:
  Rename, Favorite, Copy link, Share, Archive, Delete, and the other session
  actions. Archived sessions are grouped at the bottom under **Archived**.
- The starting page has a compact composer that starts at one line and grows
  with longer prompts or Shift+Enter. Lists, quotes, headings, and other
  non-paragraph blocks expand immediately, even with short text. This also applies
  to session composers. The editor takes the full width and controls move below;
  returning to a short paragraph restores the compact row. Height changes animate
  over 200ms, with reduced-motion preferences respected. **Agent** and **Send**
  sit inside the input on the right.
  Direct model selections show only the model name and provider icon in the input.
  Saved and coding agents show their identity beside the current model. There is
  no Chat/Code switch or separate model button.
- The agent dropdown includes every saved agent regardless of runtime, plus Cursor.
  Macro's models use the same searchable catalog as running sessions: a short
  **Recommended** list and a **More models** submenu grouped by model family,
  followed by **Agents** and **Coding agents** sections. Models have readable
  names (for example, **Sonnet 5**) and provider or model icons aligned with the
  agent icons. The in-memory catalog offers the closed Anthropic and OpenAI chat
  models; Kimi, DeepSeek, Muse, GLM, Qwen, MiniMax, GPT OSS, and Nemotron
  open-weight models; and Google's **Gemini 3.8 Flash**. Older Sonnet and Opus
  versions are not offered.
  Selecting a model here selects
  the default runtime and applies that model to the next send, retracting the repository drawer.
  A model chosen from that catalog is remembered in local storage as the
  default for Macro's in-memory agent until another model entry is picked.
  The built-in Macro agent is the only agent excluded from these sections; its models remain available.
  Unavailable paired agents stay visible with a reason.
  If Macro is unavailable, its catalog stays searchable but
  model choices are disabled in every list. Model discovery uses the
  selected runtime, including Claude Cloud. Every coding agent opens the repository
  drawer; chat agents hide it. Repository/branch overrides are currently applied
  only to Cursor sessions by the create-session API.
  Coding agents carry a `</>` badge. The most recently used supported,
  available agent is selected initially; otherwise Macro is selected.
  Hover an agent (or use the right arrow key) to open its model submenu, with
  the searchable Settings catalog, provider icons, and scrollable **More models**.
  The submenu focuses the `Search models` field so you can type immediately.
  Clicking an agent directly, or pressing Enter/Space on its focused row, uses
  its default and clears any previous model override. Right Arrow still opens
  the model submenu; choosing a submenu model selects both the agent and that
  model. Escape dismisses the picker and restores focus to its trigger.
  A checkmark identifies the selected model,
  including when it is the agent’s configured default; there is no separate default row.
  Disconnected Cursor offers **Connect Cursor**, opening Settings → Agents → Runtimes.
  The built-in sandbox and paired macrod runtimes are not offered here.
- Selecting an agent changes the heading: **What should we work on?** for chat
  agents and **What should we build?** for coding agents. The draft stays intact
  when changing agents. Unsent New conversation text and attachments also come
  back after opening a session and returning, the same way channel replies persist
  when switching channels. Home's agent input also restores unsent text, under a
  separate key from Agents → New conversation. Check the Home path explicitly:
  type a prompt on Home, visit an agent session, then return using the Home sidebar
  button or Back. The Home prompt should remain after returning and after a reload.
  Sending or clearing the input removes only that surface's saved text draft.
  **Create agent** stays pinned at the bottom of the dropdown
  while the agent and model lists scroll. It opens the roster on the selected kind's
  tab, where either kind can be created.
- On Home and New conversation, selecting a coding agent expands the input even
  with an empty or short draft. Both pages place the composer above the viewport's
  vertical center. The heading and first input line stay anchored while the composer
  expands downward. The plus attachment button stays at the far left: before the
  text in the compact row, and on the bottom control row when expanded. The editor sits above the controls, with attachments
  on the left and the agent/model and Send on the right. A full-width repository bar
  slides and fades in below the rounded input over 200ms, with rounded bottom corners
  and a subtle border along its sides and bottom, with a darker surface in dark mode.
  Selecting a chat agent retracts the bar and
  restores the compact input when the draft fits on one line, without remounting
  the editor or losing the draft. Reduced-motion
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
  default. Automatic selection always chooses an accessible repository, using
  the most recent accessible session repository when the prompt is ambiguous,
  or the first available repository for users without repository history. Questions
  and investigations also get a repository. With no accessible GitHub repositories,
  starting a coding session fails with a prompt to connect GitHub. Once selected, **Branch** shows the repository's default branch (`main` when it
  has none) and opens a searchable list of that repository's branches
  (`GET /agent-repositories/branches?repoUrl=…` on the agent harness),
  default first. Typing filters the list; an unlisted valid name adds a
  **Use name** row. Arrow keys move the highlight and Enter or a click picks
  it; there is no separate confirm button. Someone whose listing fails sees
  **Retry**. Picking a different repository resets the branch to that
  repository's default. Omitting the branch on the create-session API
  likewise starts on the repository's default branch.
  Both controls open above the footer without clipping. The selections survive
  agent changes and are sent only to coding agents. Cursor honors the explicit
  repository and branch instead of choosing a repository from the prompt;
  the owner must have access through the connected GitHub App.
  Paired macrod agents also receive the repository choice. With native Herdr,
  macrod finds an existing clone or clones it using local Git credentials, then
  creates a managed worktree from a fresh `origin/main`. **Branch** shows `main`
  and cannot be changed for local sessions. The native Claude/Codex TUI remains
  interactive in Herdr, and local turns appear in the Macro transcript.
- Sending starts a session with the chosen agent's configured default model;
  a model selected from its submenu overrides that default for the next send
  only. Sending or choosing another agent clears the override. This does not
  update the saved agent; configure persistent defaults in the agent editor.
  Within an existing session, the model picker remains available on the right.
  Its trigger, model options, and session metadata use the same readable model names
  as the new-conversation picker. The menu includes provider icons, search, a short
  **Recommended** list, and a scrollable **More models** submenu shared with Settings.
  At phone width there is no room beside the menu, so **More models** replaces the
  list in place and a **Recommended** row at the top goes back.
- Chat agents' empty input cycles tips about connectors, skills, mentions, and
  agents; coding agents show **Describe what you want to build**. Type `@` for
  mentions and `/` for skills.
  Check `/` with the Android software keyboard too: the skills menu should open
  and filter while typing, without sending the draft.
- Opening a conversation updates the URL based on that conversation's kind:
  `/app/agents/<id>` for Chat sessions, `/app/coders/<id>` for Code sessions,
  and `/app/agent-chats/<id>` for legacy chats. Reload and back/forward restore
  its mode and conversation. Newly created sessions replace their temporary
  URL with the real id without remounting the composer or adding a temporary
  history step.
- **Agents page** uses the same **Agents** management screen as Settings.
  **Agents** lists Team and Private agents with Edit / Delete actions; **Runtimes**
  configures built-in providers and paired machines. **New agent** and **New runtime**
  replace the list with full-page forms, not dialogs. Back/Cancel returns to the list;
  use **New conversation** in the sidebar to return to the composer. The animated
  **Bring your own agent** card appears only in **Runtimes**, below the tabs and
  above the runtime lists. It links directly to runtime pairing and its setup guide.
  The **Paired runtimes** section appears once you have a paired runtime; an empty
  list does not repeat the pairing action from **Bring your own agent**.
  **New runtime** shows three steps: install macrod from the linked release,
  run `./macrod` and configure your agent in Quickstart, then enter your pairing
  code and click **Look up**. Review the request and click **Approve** to connect.
  The setup guide contains configuration and pairing screenshots in that order.
  Enter the code from your own terminal, not the example screenshot.
  Run inside a herdr pane, macrod's Quickstart also offers **Claude Code in herdr**
  and **Codex in herdr**: each session of an agent on that runtime opens a herdr
  tab in the directory macrod started from, running the real Claude Code or Codex
  TUI. The session page streams its tool calls and replies, and its permission
  prompts appear as approvals. Other runtimes started inside herdr get a live
  view tab per session that can prompt and interrupt it; approvals stay in Macro.
  Native Herdr sessions offer `/compact`, `/init`, and `/fast` in the slash menu;
  Codex also offers `/ultrafast`. Macro confirms delivery of speed commands;
  check their result and any confirmation in Herdr. For Claude, use `/fast on`
  or `/fast off`, or bare `/fast` to open its native controls. Available speed
  tiers depend on the native agent, model, and account. Claude also offers
  `/effort` with an optional level, `auto`, or `status`. For Codex, use `/model`
  and choose the reasoning effort in its Herdr picker. Macro's model dropdown
  does not currently have a separate effort selector. The menu does not list
  installed native skills or session-switching commands such as `/resume`.
  The agent form retains sharing, name, `@tag`, runtime, default model, connections,
  channels, instructions, and permission policy.
  Runtime and short model lists use styled dropdown buttons: open the field and
  choose an option (or use arrow keys and Enter). Escape dismisses the menu.
  Large model lists retain the searchable model picker.
- **Session**: the header has the sidebar reopen control, a linked PR status chip,
  favorite, Share, and Side panel. The top-left title uses the same provider icon,
  saved-title precedence, and title menu as `/app/agent/<id>`; click the caret
  beside the title for shared block actions such as Rename, Copy link, Favorite,
  and Delete
  (Rename, Copy link, Delete). A metadata strip lists the agent, model,
  repository, and status. Coding sessions also list the harness; in-memory
  chat agents omit that row. Chat and Code session inputs
  use the same growing, initially single-line input with the model selector on
  the right.
  Existing sessions retain their agent and kind; use **New conversation** to
  choose another. Stop, queued-message advancement, and quoting remain available.
  Archived sessions are read-only: Rename and all message controls are unavailable,
  and an **Unarchive** action replaces the composer at the bottom. Archive /
  Unarchive is also available from the title dropdown.
- Users without `enable-chat-v3-agents` retain the Owned / Running / Shared /
  Automations / Skills list. With the flag enabled, touch devices use the new
  conversation list described above. Touch conversation links open standalone
  agent sessions or legacy chats. A standalone legacy chat is `/app/chat/<uuid>`;
  doc-scoped chat is `/app/md/<doc>/chat/<chat>` (split view).

## Routine run history

A routine's **History** can contain both legacy chats and agent sessions. Each
row opens the surface created by that run; changing the routine's execution
target does not change older links. Shift-click opens the run in a new split.
Loading metadata affects only its row. Deleted, inaccessible, or missing resources
show **Run unavailable** without a link, including failed preparation that created
no resource. Live pending rows remain neutral; persisted unsuccessful runs keep
the failure-colored timestamp even when their transcript is still available.

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
Enter on the virtual keyboard adds a line to the draft rather than sending it.
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

The **Ask AI** button beside the mobile search field sends the typed query.
It opens an agent session and delivers the query as the first prompt, regardless
of `enable-chat-v3-agents`. Mobile uses the agent session surface at
`/app/agent/<id>`; desktop uses the Agents workspace.

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

## AI usage limits

Quota admission uses the backend's default-off `ENABLE_AI_USAGE_ENFORCEMENT`
policy once configured by the host; it is independent of environment. Settlement
(credit consumption and Stripe overage collection) is gated by the separate
default-off `ENABLE_AI_USAGE_BILLING` policy, also independent of environment.
With admission enabled, cognition chat
and structured completion return 402 for exhausted allowance or 503 with
`ai_billing_unavailable` when validation is unavailable. Neither starts AI work;
chat admission also precedes chat/message creation. Existing model and chat
permission failures take precedence over quota errors. Retry 503 later rather
than treating it as approval or repeatedly sending the prompt.

Automatic chat naming is admitted independently. If naming is denied or validation
is unavailable, the successful chat continues with its existing/default title.
Usage meters, credit controls, out-of-credit dialogs, and model usage multipliers
are hidden outside frontend development mode. Normal paid-model access rules
still apply everywhere. Backend enforcement does not depend on those frontend
controls, and enabling it does not enable credit collection; that needs
`ENABLE_AI_USAGE_BILLING`. There is no new upgrade prompt in this rollout.

Session creation and spending controls also return 402/503 for admission failures.
Waiting prompts are checked again before execution: exhaustion removes rejected
work from the queue and resolves its announced reply as failed, publishing
`agent_session.command_rejected` with the action ID and safe failure details.
Billing unavailability retains waiting work for a later queue-driving event rather
than retrying continuously. Already-running turns are not retroactively cancelled;
Stop/cancel and non-spending controls remain usable. Direct ACP requests receive a
protocol error with a stable `code` and `retryable` flag, not an HTTP status.

A direct AI tool/MCP or AI-edit refusal is a failed tool result even if the outer
transport succeeds. No worker/provider edit should happen after refusal. Ordinary
manual editing, deterministic tools/imports, and the exempt Memory, AiProjection,
CallSummary, and Dictation features are not blocked by quota. Optional naming or
trigger inference may be skipped without blocking successful primary work; it
must not make a fallback model call. Managed sessions use their persisted owner
for quota, not a collaborating sender. Externally funded runtimes skip session
quota, but Macro-funded tools and helpers still check independently.

In dev, paid plans include a monthly AI allowance (Premium $40, Max $200, at Macro's
usage rates). When it is used up and no credits or usage billing cover the
request, sending a message answers HTTP 402 and the app opens the
**AI usage limit** dialog (title `You've used this month's included AI`, or the
spending-limit / failed-charge variants). It shows the same meter and controls
as Settings → Billing: credit-pack buttons, the `Usage billing` toggle, an
`Open billing settings` button, and no Max purchase or upgrade control. Team
members who are not the payer see a note to ask the team owner to add credits
or turn on usage billing.
Each team seat has its own allowance; unused allowance never moves between
members. The team owner's prepaid credits and usage-billing cap are shared.

### Quota manual checks

Use an isolated local backend with local billing fixtures, not real hosted
accounts. See [quota rollout and coverage](../AI_QUOTA_ENFORCEMENT.md) for setup
and the full matrix. Record both browser behavior and the Network/protocol result;
existing UI does not promise a dedicated quota dialog outside development mode.

1. With the flag absent/false across all hosts, send a legacy chat and a managed
   session prompt. Confirm ordinary behavior and new uncounted usage rows.
2. With enforcement true and an exhausted paid fixture, select a Macro-funded
   model and send from Home, a legacy chat, and a doc-scoped chat. Confirm 402 with
   a stable denial code, no new orphaned session/chat/message/stream, no provider
   work, and usable retry/cancel controls.
   Repeat with unavailable billing: expect 503 `ai_billing_unavailable`, not success
   or repeated automatic sends. Existing permission/model-access errors still win.
3. Start a managed turn while allowed, queue a follow-up, then exhaust the owner
   before dispatch. Check queue removal, the failed announced reply (when present),
   and the matching `agent_session.command_rejected` action ID. Do not expect a
   completed runtime turn for rejected work. During an outage, check that waiting
   work remains without a retry loop and that Stop still works.
4. Invoke AI editing on an editable document and an independent AI tool with the
   exhausted fixture. Confirm failed results and unchanged document content. Check
   manual editing and dictation still work. A successful chat whose optional rename
   is refused keeps its existing/default title rather than failing the chat.
5. Set false consistently and restart/redeploy all local processes. Retry refused
   work explicitly and confirm recovery, new uncounted rows, and unchanged counted
   history. Do not erase history to simulate rollback or claim that rollback is a
   quota reset. Check cancellation in both flag states.

## Start a doc-scoped chat

Open a doc → side panel `Actions` → `Ask Macro`. Opens an agent session with the
document already mentioned as context (a link chip in the composer). The mention
is an unsent draft: add a question, then Send. Legacy Home background sends
preserve the submitted tool selection.

## Composer anatomy (a11y)

AI chat (including Home and doc-scoped chat) and agent session composers have
a **Start dictation with OpenAI Whisper** microphone beside Send. It records
in memory and uploads to the
authenticated `/dictation/transcribe` storage endpoint only on confirmation.
Whisper is available on all plans without consuming chat credits; its server
credential is never exposed to the browser. Unsupported recording environments
show a disabled microphone. Every supported browser uses Whisper; there are
no browser speech-recognition or language-pack installation flows.

While dictating, a scrolling microphone-volume timeline and **Cancel dictation** / **Use dictation**
replace the composer controls. Cancel (or Escape) preserves the original draft.
Bars sample microphone volume as recording chunks arrive (normally every 200ms): silence stays dotted, louder speech
creates taller bars, and earlier levels move left without changing height.
Volume analysis stays on-device and stops on confirm, cancel, error, or close.
Use dictation stops recording, waits for Whisper, and appends plain text to
the draft without sending it. Existing rich text and attachments remain intact.
If the browser stops listening on its own, **Ready** waits for confirmation.
While **Finishing…**, the checkmark is disabled and Cancel remains available.
Mobile chat stays expanded when focus moves into dictation controls.
Starting dictation in another composer releases the previous session without
moving focus back to it. Closing the composer releases the microphone. Capture failures
appear below the composer.

Whisper dictation supports WebM, MP4, and Ogg recording depending on browser.
Recordings stop just before five minutes or near 8 MB and wait for confirmation.
Cancel discards the recording; cancel during transcription aborts the request and
ignores any late result. If the service is temporarily at capacity, the composer
stays in **Finishing…** while TanStack retries up to twice with exponential backoff,
jitter, and the server's `Retry-After` delay. Cancel also cancels these retries.
Other failures keep the recording in memory for an explicit retry with the
checkmark. No audio or transcript is stored in the query cache or persisted by the dictation
endpoint. Provider diagnostics exclude response content. The server detects
the audio container and inspects its duration before contacting OpenAI, requires a
signed-in user (bots and internal callers are refused), and rate limits each
user to 60 attempts per hour (failed requests and retries count). Hourly limits
show “Dictation limit reached. Please try again later.” and are not automatically retried.
The backend records provider-reported audio seconds in the shared AI usage system
and uses Whisper's per-minute model pricing without charging user credits.

Desktop composer and conversation body text use 15px type. Mobile keeps its
existing text sizing.

- Contenteditable composer (placeholder `Ask AI, @mention anything` / `Describe the edit…`).
- Model picker button showing the current model (e.g. `Haiku 4.5`). Paid plans list
  `Sonnet 5`, `Opus 5`, `Fable 5.1`, `Haiku 4.5`, `GPT-6 Astra`, `GPT-5.6`, `GPT-5.6 mini`;
  in dev, heavy models carry a `2.5× usage` / `5× usage` hint.
  On the free plan everything but `Haiku 4.5` is
  dimmed with a lock and opens the `Smart models are premium` paywall when clicked.
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
list, create, and update projects (initiatives in the API) and move tasks in or out of them,
render `displayResults` views). Requests go to `POST /cognition/stream/chat/message`; results
stream over the app's websocket, not the HTTP response.

When explicitly asked, the agent uses `CommentOnDocument` to reply with `threadId`,
start an inline markdown comment with `quote`, or start a Discussion comment with
neither. `threadId` and `quote` cannot be combined; `occurrence` only applies with
`quote`. Thread ids come from the comments returned by `ReadContent`. A reply row reads
**Replied to a comment on** (or **Commented on** for a new Discussion comment) followed
by the document, and expands to the posted text; a resolve row reads **Resolved** or
**Reopened a comment on** the document. Asked to comment on part of a markdown
document, the agent starts an inline comment on the quoted passage: the row reads
**Commented on text in** the document and expands to the quoted text and the comment,
and the passage is highlighted in the document with the comment floating beside it.
A passage that is missing, spans blocks, or repeats with no occurrence chosen is
refused with no highlight left behind. The comment is posted as the agent with a
**from <user>** pill, and needs the user's comment access to the document.

Project rows include **Find projects**, **Read project**, **Create project <name>**,
**Update project**, **Add N tasks to project**, and **Remove N tasks from project**.
The assignment and removal rows show a task count; the caret expands each task id
and its outcome, with the full response available under **Result data**. Assignment
outcomes are **assigned**, **moved**, **not a task**, **not found**, or
**skipped no permission**. Removal outcomes are **unassigned** or **not assigned**;
a task in a different project is left unchanged. Both actions require edit access
to the project and each task. Removal stops on access or service failures, so
previous tasks in the same batch may already have been removed.

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

Mention `@Macro` in any channel message. Without the `enable-chat-v3-agents` rollout it is
the classic in-channel reply; with it, the same mention opens an **agent session** — a
dedicated transcript at `/app/agent/<uuid>` whose replies also stream back into the thread.
`@coder` / `@cursor` always open a session. There is only ever one Macro entry in the
mention menu; which of the two answers is the rollout's decision, not a second choice in
the menu.

## Agent sessions

An agent session is `/app/agent/<uuid>`. The composer placeholder is
**`Message the agent, @mention anything`**. Creating one (`c` then `a`, or
`Create` → `Agent`) leaves that composer focused — on mobile that is the same
Create-menu `triggerFocusInput` as chat, so the keyboard opens. Type `/` to
open sections for **Skills**, **Pull requests**, and **Commands**. Skills are
available even before the connected agent advertises commands. Select a skill
to insert its mention, a pull request to reference it, or a harness command
to insert `/name` as text. Search filters all sections; arrow keys move across
sections and Enter selects the highlighted item. Saved skills have an **Edit**
button that opens their document editor; skills you own also have **Delete**,
which opens the usual deletion confirmation. Built-in skills have no edit or
delete controls. **New skill** creates a skill and inserts its mention. Type `@` to insert the same mention chips
used in chat and channels; they serialize as mention-chip tags in the prompt
the agent sees (`<m-document-mention>` for docs/channels/chats/tasks/emails/calendar
events/skills, `<m-date-mention>` for a day or time, `<m-agent-session-mention>`
for an agent session, `<m-user-mention>` for a person, and the other chip tags).
Clicking a chip while it still sits in the composer (Home, the Agents page, or
an agent session) opens the mentioned item in a new split and leaves the draft
and caret untouched; it does not send anything.
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
Expanded queued prompts
list their attached file names under the text; editing a queued prompt keeps them.

On a local stack, the in-memory agent reads uploaded image attachments from local
storage and sends their bytes to the model. The provider does not need access to
the stack's private hostname. This also applies to images in earlier turns when
resuming a conversation after a service restart.

Cursor walkthrough files the run re-hosts appear in the transcript after the
answer: screenshots as images, recordings as video players, and `.txt` / `.log`
files as an inline `txt` code block (not a download link). Larger or non-UTF-8
text stays a link.

When a Cursor run subscribes to something outside the conversation (a CI run,
a pull request, a Slack thread, a Linear issue, a timer), Cursor feeds the
event back as a prompt wrapped in `<system_notification …>`. The transcript
renders that as a full-width event card, not a prompt bubble: a source header
(e.g. **GitHub · CI checks**), a pass/fail pill when the event carries a
`conclusion`, the summary line, and chips for the repository, branch, short
commit and check count (repository and commit chips open GitHub). Attributes
the card has no face for appear as `name: value` chips; the subscription id
is hidden. The same tag renders as the same card anywhere internal markdown
is shown; a tag inside a code fence stays code. Text between notification
blocks keeps the message in its author's prompt bubble. Card links accept
only HTTP or HTTPS URLs; invalid repository links stay as plain chips and
invalid event links are omitted.

On mobile the composer (and any queued prompts above it) floats in the bottom
accessory region above the dock — same placement as channel and AI chat — so it
stays tappable and clear of the home indicator. The box is full width; the text
sits on top and a footer row holds the model (left, as a provider logo and
name, e.g. `✳ Sonnet 5 ⌄`) and **Send** (right). On touch devices Enter on the
virtual keyboard inserts a newline and never sends; only **Send** submits, the
same as channel composers. This also applies to the Agents workspace session
and new-conversation inputs and to the mobile **Ask AI** composer. On desktop
Enter still sends and Shift+Enter inserts a newline. Tapping the model opens a
bottom sheet listing every model the same way, with a check on the current one
— pick a row to switch. Models read as names even when the runtime reports
only ids: Macro Agent's `anthropic/claude-sonnet-5` shows as **Sonnet 5**. On desktop the
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

Tool rows show the tool's own name without an MCP server or workspace prefix.
Chat MCP rows retain their service icon.

Individual tools appear as bare rows with an icon, tool name, optional detail,
and a right-aligned result summary. The caret on the right opens the results;
it points right when collapsed and down when expanded. Individual results start
collapsed. Existing rich result views retain their own content and controls;
when a result view provides its own disclosure, use that control rather than
adding a second nested disclosure. Counts come from structured responses,
edits show additions/deletions, and other tools show their outcome. A call cut
off when its turn ends reads **Stopped**.

Only tools with a supported result view can expand. Unknown tools, unsupported
drafts, and payloads that do not fit their renderer stay as summary rows with
no caret. Tool arguments and results never fall back to raw JSON.

Tool runs keep one group from their first call. Historical runs start collapsed;
live calls get a 150 ms buffer, so fast parallel bursts can finish as **Called N
tools** without flashing a list. Ongoing work opens a scrollable window of at
most five compact rows. The window follows unfinished calls first, keeping slow
work visible even when later calls finish, until you scroll or interact with it;
scrolling back to the bottom resumes following. An automatically opened window
stays visible for at least 600 ms and waits for 150 ms without an active call
before collapsing smoothly. These delays are shared by the group, never queued
per call, and do not delay answer text or tool execution. Manually opening,
closing, or interacting with a group overrides automatic collapse. Subagents
and tools requiring user input remain outside these groups so they stay visible
during other tool bursts. Nested agent activity has its own scrollable window.

The group caret sits immediately after its label and appears on hover or keyboard
focus. Expand an edit row to view its diffs. Result bodies load only when their
row opens; syntax highlighting may appear after the diff text. Opening a session
or expanding a group should leave the app responsive, even when the session
contains many file edits.

`DisplayResults` renders its dynamic view directly in the reply and stays visible
without opening a tool row. It breaks tool groups before and after itself,
including while pending; later calls start a separate group.
Its dashboard supports markdown, timelines, entity lists, and channel messages,
using the same full-width view as AI chat. Incomplete arguments stay hidden while
streaming; a valid view updates as arguments arrive. Malformed completed views
show **Couldn't render dashboard**; failed calls show a **Failed** summary row
without a disclosure. Macro's built-in agents receive the complete view schema
with the tool definition. External coding agents connected through Macro's MCP
server do not currently receive this tool.

The development gallery at `/app/component/agent-ui` includes **Replay tool
calls** and **Replay fast batch**, both using the message renderer. Check that
ongoing rows accumulate in the five-row window, completed calls stop shimmering,
fast batches stay compact, and the group collapses smoothly after completion.
Its carets should still expand the results, and reduced motion disables animation.
Check that rich result controls still work and `DisplayResults` stays visible
between surrounding groups. In **AgentMessage (end-to-end)**, expand the group
and confirm unknown tools have no individual disclosure or JSON payload. Repeat
at a narrow viewport width.

A thought row reads **Thinking** and shimmers only while it is the last part
of the turn the session is working on. Earlier thoughts settle to **Thought**
as soon as a tool or answer follows, including during long Cursor turns. A
trailing thought at the end of a message stays outside the tool group so live
reasoning stays visible; thoughts followed by prose stay inside the group.
Only the newest turn can be live: once the composer stops showing the
agent as working, every Thinking label, **Calling N tools** row, shimmering
tool title, and working row settles — earlier turns never shimmer, even ones
the runtime cut off mid-call. Shimmer identifies current activity: an active
tool and its containing group can shimmer together; completed rows stay still.

### Sharing a session

In the Agents workspace, saved sessions use the shared top-bar controls: session
icon, title and action menu, Share, Copy Share Link, and a side-panel toggle.
There is no breadcrumb because Agents has no subspaces. Unknown model providers
fall back to the chat icon. The toggle (or `]`) opens the session's Details, Plan,
Changes, Activity, and References sections when available, beside the transcript in wide
layouts or over it in narrow layouts; it does not open another split.
Details lists Status, Agent, Model, and dates for every session; the Runtime
row appears only for coding runtimes, never for in-memory chat agents.
`References` is the same section documents show: one row per channel message that
`@`-mentioned or shared the session (sender, channel chip, time, and a two-line
message excerpt) and per document that mentions it (author and document chip).
Click a row to open that message or document in a split. The section is hidden
until at least one reference exists, and only lists channels you belong to.
New conversation pages have no disabled session action buttons. Older chats
also have one header row, and empty chats show a simple conversation prompt
instead of the standalone recent-sessions and tips surface.

Saved sessions have **Share** and **Copy Share Link** in the desktop header;
on mobile, open the session title menu and choose **Share**. The owner can
select people or channels, choose their access level, and send the session with
an optional message using the same Share dialog and mobile drawer as tasks.
Sessions also support **Share** from entity list menus and the entity sharing
shortcut. **People with access** lists the owner and shared conversations;
the owner can change or remove a conversation's access. **Link sharing** offers
None / Public / Team and an access level. **Team access** shares directly with
the owner's team when one exists. On mobile these controls are in the Share,
People, and Link tabs. View and Comment allow reading; Edit also allows
controlling the session. View-only sessions keep the composer, model selector,
and queued-message controls disabled. **Copy Share Link** remains in the header. Cancel
closes the composer without sending.

Sharing a session reference in a message grants View by default and preserves
an existing grant. Use the access selector to grant Comment or Edit.

Other participants can copy a link for people who already have access, but
cannot grant access or change sharing settings. Copying a link alone never changes permissions. New,
unsaved session drafts do not offer sharing.

Agent sessions in the `@` menu use the shared Quick Access feed, loaded when the app opens. Search matches session titles and agent names. The initial feed covers the 500 most recently updated accessible sessions; it does not load transcripts.

### Replying to selected agent text

On desktop, drag to select transcript prose or expanded **Thought** text, then
choose **Reply to this** above the selection. The composer inserts a single-line
**Replying to** preview with the same quote-reply styling as channel replies.
Click the preview to open the full **Referenced text** viewer. While editable,
hover the preview for its menu: **Copy**, **Convert to text**, or **Delete**.
Selecting text in the composer or outside the transcript must not show the reply
button; clearing the transcript selection dismisses it.

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
turn ends, regardless of the coding runtime. Unpushed workspace changes and
branches without a PR are not included. The session header gains a **Changes**
toggle (`aria-pressed`) with green additions and red deletions (`+N −M`); it opens a resizable
**Changes** pane beside the transcript (drag the 1px divider between them).
Chat sessions on Macro's in-memory harness have no repository, so they show
none of this: no **Changes** toggle, pane, hand-off card, or review-notes chip,
and the title menu offers **Open repository** only when the session has one.
The session's split stores the pane in its own search params:
`s<N>.changes.pane` (`split`, or `full` when spotlit) and `s<N>.changes.style=split`
for side-by-side diffs, where `<N>` is the split's index; defaults are left out.
Copying the URL preserves that view, and reload restores it. Opening and closing
the pane are Back/Forward steps; switching the diff layout is not. A plain
session URL starts with Changes closed, and leaving the session or closing its
split drops the state.
Divider width, whether the file tree shows, collapsed files, and review notes
stay local.
The pane (`[role="region"][aria-label="Changes"]`) has a title row and a
toolbar. The title row shows **Changes**, the linked pull request's number
(**View pull request #N** opens GitHub), and the `head → base` range, with only
the pane's own controls on the right: **Expand changes to the full width**
(pressed while spotlit; its label becomes **Back to the split**) and **Close the
changes pane**. The toolbar, shown once there are files, has **Hide file tree /
Show file tree** and the file count on the left, and on the right the
**Unified / Split** segmented control (`aria-label="Diff layout"`), **Collapse
all / Expand all**, and **Refresh pull request changes**.
The body is a file tree (`[role="group"][aria-label="Changed files"]`, rows
styled like Drive's folder tree, directories compressed along single-child
chains with **Collapse / Expand** buttons, each file's +/− counts and status
letter A/M/D/R; the arrow keys move between rows and Left/Right close and open a
directory) next to a scrollable stack of file cards. Expanded cards keep their full height;
**Collapse all / Expand all** hides or restores their bodies. Each card's header has a disclosure
caret, the path, `+adds −dels`, and **Copy path**. Diffs render with Pierre; hover a
line and click the accent **+** in the gutter (drag for a range) to leave a
review note for the agent (`aria-label="Review note"`; `Cmd/Ctrl+Enter` adds,
`Escape` cancels). Notes hang under their line as "queued for the agent" and a
**N review notes queued · Send to agent** chip appears above the composer.
The chip's count row expands (`aria-expanded`) to show each queued note's
file, line, and text so the reviewer can read or edit them before sending;
**Send to agent** then posts one prompt listing every non-empty note by file
and line and marks them "sent to agent". Sending a typed composer message
while notes are queued includes those notes in the same prompt and marks them
sent — a second Enter does not post them again. Clicking a note's path opens
that file in the Changes pane. Notes never go to GitHub. Collapsed files and
unsent notes persist per session in localStorage; a new capture expands all
files.

The session header's **Changes** pill and sidebar totals display the linked
PR's `additions` and `deletions` returned by the GitHub API, without summing
transcript edits. The sidebar lists files from the captured PR diff. Counts
refresh when a capture changes and every 30 seconds while the session is open.
Zero-valued counts and unavailable GitHub statistics are hidden; a missing PR
or failed GitHub request never falls back to estimated transcript totals.

While the pane is closed and a capture has files, a **Changes ready to
review** card sits above the composer with **Review changes**, **Pull request
#N** (opens GitHub), and **Dismiss**. With no linked PR, the pane explains
that a GitHub PR is required. Ask the agent to open one and register its URL
with `set_pull_request`, then use **Refresh changes**. An unavailable or
oversized PR is explained in the pane; there is no branch or container fallback.
Refresh request failures show a retry banner while keeping the last diff visible.
The pane does not create PRs or generate their descriptions.
### Live development previews

Coding agents can call the internal **SharePreview** tool with their local HTTP
server port and execute the returned SSH script in that same environment. Keep
the server running while editing; ordinary HTTP and WebSocket HMR traffic are
forwarded. Never paste the script or its credentials into a final chat message.

In an agent session (`/app/coders/<uuid>` for a coding session), the banner
above the transcript moves from **Agent is
connecting a preview…** to **Agent is sharing a preview** once HTTP is reachable.
Click **View preview ↗** to open a new tab. Any viewer of the agent-session entity
can open it; a copied preview URL alone does not authenticate another browser.
Allow popups if opening is blocked. The destination is an isolated HTTPS origin
with normal root paths and no authorization query parameters.

The owner can click **Stop sharing** in the banner; open preview connections
close. Disconnection and expiry leave a banner asking the agent to share again.
Leases last up to one hour and expire after 15 minutes without browser requests.
Continue prompting in the agent session while the preview tab stays open; page
edits should arrive through the app's own HMR connection.

### Transcript navigation

Agent sessions reuse the channel's TanStack `ThreadList`. Opening a session lands
at the latest message, including when history arrives after the empty view. Short
transcripts start with 16px of top padding, with the user prompt followed by the
agent response; streaming output grows downward into the available space. Only
the visible rows and an overscan buffer are mounted: scroll to older turns before
searching their DOM text.

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
  than queued. Waiting prompts are written through to the session store as they are
  accepted, edited, or removed, and are restored when the session resumes after a
  harness restart — they must not disappear if the managing replica drains.
- Queued prompts render as a list between the transcript and the input, newest at the
  top — the prompt about to be sent sits at the bottom, immediately above the input.
  The list is capped at the smaller of 40% of the viewport height and 24rem. Past that
  it scrolls on its own and starts scrolled to the bottom, so the next-to-send row stays
  visible. Scroll up inside the list to reach newer entries; no extra count row hides
  messages. Each prompt starts as a single-line preview, including long messages.
  Click a preview (or press Enter/Space on it) to open its editor; opening another
  row collapses the previous one. The expanded editor scrolls within the smaller of
  32% of the viewport and 16rem. Click the preview again or press Escape to collapse
  it, retaining edits and editor state. Each row shows a `Queued` label (with `by
  {user}` when someone else queued it —
  several users can stack prompts in one session's queue) and an always-visible remove
  (`X`) button. Type in the expanded editor — changes
  autosave (debounced, and on blur) with no save button. Editing and removal are
  possible only until the entry dispatches; after that the row simply becomes the next
  user message in the transcript.
- Keyboard: Up at the very start of the composer input moves focus into the
  bottom (next-to-send) queue row; further Up presses walk toward newer entries, Down
  walks back and past the bottom row returns to the input. When the composer is empty
  and a prompt is queued, its action becomes `Send next queued message` (an Enter
  symbol); pressing Enter or clicking that button cancels the current turn so the next
  queued prompt starts immediately. The advance is held — the control reads `Stop` and
  Enter is inert — while a stop is already in flight or while the prompt the last
  advance sent is still unconfirmed (it shows as a pending bubble); once the server
  confirms that prompt as the running turn, Enter advances the queue again. Two rapid
  Enters therefore advance one entry, not two: each advance ends the turn the server is
  actually running. Typed composer text still takes priority and Enter
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
- **Runtime bypass consent.** Settings → Agents → Runtimes → New runtime offers
  `Allow bypassing permission requests`, off by default. Enabling it warns that
  agents may run commands and edit files on the machine without approval.
  Macrod Quickstart and Config also offer `Full Access`, off by
  default. The choice applies at the next pairing: off disables bypass in the
  pairing page; on preselects bypass with a warning, and the approving user
  can turn it off. Older daemons leave this choice to the pairing page.
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

### Agent reasoning effort

Open the model selector and hover a model to choose its reasoning effort in the
submenu. Keyboard users open it with Right Arrow; touch users tap the model.
Cursor and Macro's in-memory agent load the hovered model's own advertised
choices. The selected label includes the effort, such as `Sonnet 5 · High`;
there is no separate effort control in the input box. Models without effort
support remain selectable through `Use <model>` (or a desktop click/Enter).
Default keeps the model's existing behavior.

In an open session, choosing a different model's effort confirms the model first,
then validates and applies effort. Wait for the selector to become available
again. If the model succeeds but effort is rejected, the new model remains
selected with its confirmed effort; the error is shown and no unsupported
setting is presented as accepted.

New conversations confirm selected model and effort settings before sending the
first message. If startup reports a rejected setting or timeout, the first prompt
has not been sent. See [effort capabilities](../AGENT_EFFORT.md) for the harness
contracts and test coverage.

Routine model/agent pickers retain model-only selection: they do not offer effort
choices, because routine targets do not save an effort setting.

## Reading skills

Agents in Macro and connected MCP harnesses can discover saved skill documents
and built-in skills with `ListSkills`, then load the full instructions with
`ReadSkill` using the returned `documentId`. `ListSkills` returns the 100 most
recently updated visible skill documents plus built-ins; `SearchSkills` finds a
skill by name, including older skills outside that list. A skill mention's id can
also be passed directly to `ReadSkill`.

## Configuring agents from a conversation

The built-in **Configure Agent** skill walks an agent through changing another
agent's instructions or settings on the user's behalf. `ListAgents` returns every
agent the user can manage with its current instructions, runtime, model, channel
scope, connected apps, permission choice, and coding/chat mode; `ConfigureAgent`
patches only the fields it is given. A selected MCP app slug must be a real
Pipedream app; an invented slug is rejected and the agent is left unchanged.
Instructions are replaced whole, so the skill
has the agent edit the current text and send the complete result. Changes reach
sessions opened afterwards; running sessions keep the instructions they started
with. Both tools render as expandable rows in chat, agent sessions, and channel
replies; the profile fields (name, handle, description, picture) stay with
`ConfigureBot`.

The chat's **Read skill** tool row expands to show the full instructions. When
verifying this flow, invoke a saved skill by name, confirm the agent reads it,
and expand the row to inspect the returned content. Document access permissions
apply; ordinary documents and deleted skills cannot be read as skills.
