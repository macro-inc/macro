# Block feature list

A block-by-block reference of what Macro can and can't do. The audience is agents (and power users) who already understand the product at a high level and want to confirm whether a specific capability exists inside a given block, and how that block links to the rest of the workspace.

Each block type is an `# H1`. Under it you'll find what the block does, the specifics worth knowing (fields, formats, shortcuts, property types), and an **Integrations** section describing how it interlinks with other blocks. Where a feature is behind a flag or mid-migration, it's called out so you don't promise something that isn't live yet.

> This is v1, generated from the codebase. Treat it as the source of truth for "does this exist," and flag anything that looks stale.

---

## How blocks work (read this first)

Everything in Macro is a **block**. The registry of block types is: `md`, `email`, `channel`, `chat`, `automation`, `project` (tasks), `contact` (CRM), `call`, `canvas`, `code`, `image`, `video`, `pdf`, and `unknown` (fallback). Two aliases route to existing blocks: `task` → `project`, and `csv` → a document/text block.

Shared platform concepts that show up in almost every block:

- **Splits** — Any two blocks can sit side-by-side in a split layout (e.g. a doc next to a chat, an email next to a task). A handful of combinations are restricted (you can't split a doc with another doc of the same kind, code-with-code, or pdf-with-pdf unless multisplit is enabled). Create a split with `cmd+\`, focus left/right with `shift+h` / `shift+l`, maximize with `shift+escape`, close with `cmd+escape`.
- **Nesting** — Some blocks embed read-only inside a markdown doc: `canvas`, `pdf`, and `code` can render nested in `md`. Nested blocks disable their editing/markup tools.
- **Properties** — A unified property system (text, number, boolean, date, single/multi-select, entity-reference, link) attaches to documents, tasks, emails, CRM records, and more. See the CRM and Tasks sections for the full type list.
- **References** — Every block has a References panel showing everywhere it's @mentioned or embedded across the workspace (backlinks).
- **Sharing & permissions** — Every block uses the same share dialog and access levels (owner / editor / commenter / viewer), plus public link sharing for documents.
- **Real-time collaboration** — Collaborative blocks (docs, canvas, pdf markup) sync through **Loro CRDTs** over a **Cloudflare Durable Objects** backend. The Rust `sync-service` spins up one Durable Object "room" per document; clients connect over WebSocket to `/document/:id`. This gives multiplayer editing, presence/cursors, and full offline support (edits reconcile when you reconnect). A separate `lexical-service` Cloudflare Worker handles server-side conversions (plaintext, search/cognition preprocessing, markdown→Loro snapshots).
- **Search** — One unified index covers all block types; results are filterable by type and by @mentioned person.

---

# Markdown / Documents

The default document type. A Lexical-based, markdown-native collaborative editor. "Documents" is also the container that holds other file types (canvas, code, pdf, images) — anything created or auto-extracted lands here.

> Create with `c` then `d`.

## Editing & formatting

- **Block nodes:** paragraphs, Heading 1/2/3, bullet lists, numbered lists, checklists (interactive checkboxes), blockquotes, code blocks (Prism syntax highlighting, 15+ languages), tables, horizontal rules/dividers, images, videos, and links.
- **Inline formatting:** bold (`cmd+b`), italic (`cmd+i`), underline (`cmd+u`), strikethrough (`shift+cmd+x`), highlight (`shift+cmd+h`), inline code (`cmd+e`), plus superscript and subscript.
- **Math / LaTeX:** inline and block equations rendered with KaTeX.
- **Markdown autoformatting:** `#`/`##`/`###` for headings, `-` for bullets, `1.` for numbered, `[]` for checklists, `>` for quotes, `---` for a divider, backticks for code.
- **Emoji:** `:shortcode:` support with search/insert.
- **Drag-to-reorder** blocks, **tab/shift-tab** to indent/outdent, find & replace (`cmd+f`, regex supported, replace one/all).

## Slash menu

Typing `/` (or the command menu) inserts: Normal text, Heading 1/2/3, Blockquote, Code block, Bullet/Numbered/Checklist, **Task** (inline task with mentions), Image, Video, Link, Equation (`/latex` or `/math`), Table (5×3), Divider.

## @Mentions

Mentioning is the primary way docs link to the rest of the workspace. Mention types:

- **Documents / blocks** — link any doc, task, canvas, code file, pdf, etc. Renders as an inline pill (collapsible) with live metadata; for tasks it shows status/priority.
- **People** — by name or email.
- **Contacts / companies** — CRM records, formatted differently for people vs. companies.
- **Channels** — deep-link to a channel.
- **Dates** — date pills.
- **Groups** — group aliases.

## Comments & suggestions

- Inline, thread-based comments anchored to a text selection.
- Reply, resolve/unresolve, edit/delete your own, draft comments.
- Comments are what generate inbox notifications (see Integrations) — body @mentions do not.

## Properties & metadata

- Side panel shows Details (owner, folder/project, created/updated) and a Properties section.
- Pin properties for quick access; pinned values render as pills under the title when the panel is closed.
- Optional YAML front-matter display toggle (per-doc preference).
- Word/character count in the side panel.

## History & versioning

- Full version history via time-travel; browse historical states grouped by user/time.
- **Fork** a document at any past version into a new doc.

## Sharing

- Owner / editor / commenter / viewer access levels.
- **Public link** sharing — viewers outside Macro can open a read-only preview with no account or login. Sharing a doc via a Macro message auto-updates its permissions so recipients can open it.
- Copy link (`shift+cmd+c`).

## Export & media

- Export/download as markdown text.
- Image/video upload (paste, drag, or media picker) with presigned-URL storage.

## AI

- Inline AI generate / rewrite (with side-by-side diff insert/delete nodes) and streaming completions exist in the codebase but are **temporarily disabled pending a migration** — don't assume inline doc AI is live.
- You can dispatch an agent task with the document as context from the doc itself.

## Integrations

- **Tasks:** create a task inline with `/task`, or convert any checklist item into a real task (pulls @assignees and date mentions out of the line). Tasks embed back into docs as live mention pills.
- **Channels / Email:** @mention a doc in a channel or email and it becomes a link; permissions update so recipients can view.
- **Agents:** agents read and create documents (`CreateDocument`, `ReadContent`); docs are first-class chat context.
- **Search & Inbox:** always full-text searchable; comment @mentions land in your inbox; the doc surfaces in the inbox when it has an open notification and recent activity.
- **GitHub:** task-documents show linked PRs inline (see Tasks).
- **Nesting:** can embed canvas, pdf, and code blocks read-only.

---

# Email

Keyboard-driven email with Gmail sync, a rich Lexical composer, and Signal/Noise triage. Recommended to link at signup.

> Compose with `c` then `e`. Triage with `j`/`k` to move, `e` to archive.

## Accounts & sync

- **Multi-account / multi-inbox** — link several inboxes; pick which one you send from via the From selector. Primary inbox is detected automatically; non-primary writes are scoped correctly.
- **Providers:** Gmail (primary, full label/category/threading sync), plus Outlook/IMAP via the inbox-linking system.
- Resync and delete linked inboxes from settings.

## Compose

- New, reply (`opt+r`), reply-all (`r`), forward (`f`); CC (`shift+cmd+c`) and BCC (`shift+cmd+b`) toggles with drag-and-drop between To/Cc/Bcc.
- Rich-text body (Lexical): bold/italic/underline, lists, quotes, code, markdown; format ribbon toggle.
- **Attachments** up to 18 MB total; inline image/video previews.
- **Drafts** autosave (debounced); explicit save/delete; drafts that are replies render inline under the parent message; undo snapshot restores recipients/subject/body/attachments.
- **Send** with `cmd+enter`. **Scheduled send** (date/time picker, with unschedule) is feature-flagged.
- Default "Sent with Macro" signature (removable on paid).

## Triage

- Archive / mark done (removes from inbox), trash (with 10s undo), mark read/unread (auto-marks on view), **block sender** (future mail → trash, undoable).
- Navigate messages with `arrowup`/`arrowdown`; collapsed messages show sender + snippet + date, click to expand; infinite scroll loads older mail.

## Signal vs Noise

- Email splits into **Signal** (important, e.g. teammates, customer feedback) and **Noise** (newsletters, promotions, social, forums). For Signal, a thread must be marked important **and not** shared to you by someone else.
- Right-click a thread (or use the actions) to mark a sender **Signal** (creates an `is_important=true` filter) or **Noise** (`is_important=false`); both are undoable.

## Labels

- View, add, and remove thread labels; list your label set. Agents can read and modify labels (`UpdateThreadLabels`, `ListLabels`).

## Side panel

- Details: Last Sent, Last Received, Thread Started, Subject. Plus a custom Properties section.

## Security & rendering

- Sanitized HTML rendering with external image proxying; plain-text→HTML fallback.

## Integrations

- **@Mentions inside the body:** mention a **person** → they're added to CC (toast confirms); mention a **document** → inserted as a link and the doc's permissions update to link-viewable.
- **Tasks:** "Create Task" from a thread pre-fills the title from the subject (truncated) and links the thread into the task body.
- **Channels:** share a thread into a new/existing channel (feature-flagged); participants get a left-panel notification and can view the whole thread read-only — to reply they must be forwarded the mail.
- **Agents:** "Chat with agent" opens a chat with the thread as context; agents can read threads (`GetThread`/`ReadThread`) and compose/send (`SendEmail`, with user review before send).
- **CRM:** senders/recipients auto-link to contacts and companies; per-company email sync feeds the CRM.
- **Documents:** attachments auto-extract into the Documents container with one click.
- **Inbox:** important, non-shared threads with open notifications surface in the unified inbox.

---

# Channels

Team chat. Like Slack, but with Reddit-style nested threading and Signal/Noise on pings. Anyone can be added by email, including non-Macro users.

> Create with `c` then `m`. Find in channel with `cmd+f`.

## Messaging

- Full Lexical rich text: headings, bold/italic/underline/strike/highlight/inline-code, bullet/numbered/checklists, code blocks, quotes, tables, dividers, links, images, math, video embeds; format-ribbon toggle.
- Edit (`e`) and delete (`backspace`) your own messages; copy text; copy message link; "(edited)" indicator; soft-deleted messages show as removed.
- Consecutive messages from one sender are grouped; date dividers; "new" divider; sticky scroll with a scroll-to-bottom overlay; typing indicators.

## Reactions

- Emoji reactions with a picker; quick reactions (❤️ 👍 😂), per-emoji counters, click to remove.

## Threading

- Reddit-style nested threads: expand/collapse a parent into its replies, dedicated thread reply input, quote-reply (`>` prefix), reply pagination. Navigate replies with arrow keys; `enter` to reply, `e`/`backspace` to edit/delete your reply.

## Membership

- Add participants by email (Macro or not — non-users get an email about the notification). Participants tab to view/search/remove members.
- `@user` to mention someone, `@here` for everyone in the channel, `@Macro` to call the agent inline (it can summarize, answer workspace questions, etc.).

## Attachments & sharing in

- Drag-and-drop files, or attach via the paperclip; image/video gallery with a media viewer.
- Drag or @mention **entities** into a message to share them: documents, tasks, other channels, specific messages/threads (deep-linked), calls, and emails.

## Calls

- Start or join a call from the channel header; screen share, audio/video toggle, mute, participants panel, plus a Call History tab. (See the Calls block.)

## Navigation & state

- Find-in-channel (`cmd+f`) with match highlighting and paginated results; `arrowup`/`arrowdown` to move between messages, `shift+g` to jump to latest, `escape` to clear selection.
- Last-viewed tracking and new-message indicators.

## Integrations

- **Tasks:** create a task from any message (hover action); convert message checkboxes into tasks.
- **Agents:** `@Macro` runs the agent in-thread; "Chat with agent" uses a message as context.
- **Everything else:** emails, docs, tasks, calls, and other channels all share into channels as deep-linked entity mentions.
- **Inbox / notifications:** mentions and replies create inbox items; Signal/Noise classification separates important pings from `#random`-style noise.

---

# Chat / Agents

The agent workspace. Streaming chats with an agent that has full read/write access to your workspace, plus a history of every conversation.

> Create a chat with `c` then `a`. Go to the Agents tab with `g` then `a`.

## Models

- Selectable per chat: **Smart** (default; reasoning), **Fast** (speed), **Opus 4.7**, **Sonnet 4.6**, **Haiku 4.5**. All Anthropic. Mobile defaults to Smart.

## Chat experience

- Token-by-token streaming with a stop control; persistent history; auto-named from the first message; reopen and continue any past chat.
- Share, rename, duplicate, delete chats; chat list with search.
- Custom AI instructions per chat (editable in the top bar), References panel showing sources used.
- AI data-consent gate on mobile.

## Context & attachments

- @mention channels, docs, tasks, people, and email threads to pull them in as context; autocomplete surfaces currently-open tabs.
- Attach files (paste / drag-and-drop) with an upload queue and progress; mentioned entities auto-attach.

## Tools (MCP)

The agent runs against Macro's MCP tool registry. Available tools:

- **Search/discovery:** `ContentSearch`, `NameSearch`, `ListEntities`.
- **Read:** `ReadContent`, `ReadMetadata`, `ReadThread`, `GetThread`, `GetEntityProperties`.
- **Create/modify:** `CreateDocument`, `SetEntityProperty`, `UpdateThreadLabels`.
- **Communicate:** `SendEmail`.
- **Execution:** `bash_code_execution`, `text_editor_code_execution`.
- **Web:** `web_search`, `web_fetch`.

The same MCP server is reachable externally at `https://mcp-server.macro.com/mcp` (OAuth), so Claude Code / Codex / any MCP client can drive the workspace too.

## Integrations

- The agent can create tasks, draft/send emails, create documents, set properties/assignees, and read across email, channels, docs, calls, and CRM.
- Outputs surface in the Agents tab and the Inbox.

---

# Automations

Scheduled agent runs (cron jobs). Same agent and tools as Chat, on a recurrence.

> Created from the Agents module → Automations tab.

## Authoring

- Composer with a name (auto-derived from the prompt, up to ~72 chars), a markdown instruction/prompt editor, schedule, and timezone (defaults to local).
- @mention channels, docs, tasks, and people inside the prompt.

## Scheduling

- **Weekly** (pick days; presets for weekdays / weekends / every day) or **monthly** (day 1–31), at a chosen `HH:MM`. Defaults: weekly, weekdays, 09:00.
- Shows next run in plain language; stored as standard 6–7 field cron (ranges, lists, wildcards supported). Max 20-minute runtime per run.

## Management & results

- Edit, enable/disable, rename, delete, and **Run Now**; "Running" indicator.
- Run history (latest ~50) with timestamp and success/failure; each run produces a chat artifact you can open.

## Integrations

- Each run can use the full MCP toolset (create tasks/docs, send email, update entities).
- Results appear in the **Inbox** and the **Agents** tab at the scheduled time.

---

# Tasks

Lightweight task tracking (block type `project`, alias `task`). Deliberately low-ceremony: status, priority, assignee — no extra label/category sprawl required.

> Create with `c` then `t` (or `shift+t` for a new split).

## Fields (built-in system properties)

- **Status** (single-select): `Not Started`, `In Progress`, `In Review`, `Completed`, `Canceled`.
- **Priority** (single-select): `Urgent`, `High`, `Medium`, `Low`.
- **Assignees** (multi-user).
- **Due Date** (date).
- **Parent Task** / **Subtasks** (task hierarchy).
- **Depends On** (blocking relationships).
- **Effort** (number), **Story Points** (number).
- **Relevant Documents** (multi-doc references).
- Plus any **custom property** (see CRM for the full type list). Default pinned: Status, Priority, Assignees.

## Views

- **List** — table with inline-editable property columns (name, status, priority, assignees, created-by, updated).
- **Board / grid** — kanban grouped by status with drag-and-drop columns.
- **Grouping:** none, status, priority, assignee, project, date. **Sorting:** updated, created, viewed, priority, status. **Filters:** active, by status, by priority, assigned-to-me, by assignee, and any custom property.

## Creating tasks

- Keyboard (`c`+`t`), launcher/create buttons, **from an email** (pre-fills subject as title, links the thread), **from markdown/channel checkboxes** (extracts @assignee, date mention, title, and checked→Completed), and inline in docs via `/task`.
- Duplicate-task detection via similarity search.

## Keyboard (task-specific)

- `shift+cmd+o` open property editor · `shift+cmd+p` set priority · `shift+cmd+a` set assignee · `shift+cmd+s` set status · `shift+cmd+b` copy branch name.

## GitHub integration

- Link your GitHub account in Settings → Account.
- Linked PRs render inline on the task with name, number, status, and +/− line counts.
- Status auto-transitions as you work: branch created → **In Progress**, PR opened/in review → **In Review**, PR merged → **Completed**. The task knows which PR ID maps to it.

## Integrations

- @mention tasks in docs, channels, emails, and chats — they render as live status pills.
- Assigned tasks appear in your **Inbox** (a `task_assigned` notification); marking done from the inbox completes the task.
- Agents create and update tasks via `CreateDocument` / `SetEntityProperty`.
- Bulk operations: rename, move to project, delete, edit properties (with undo).

---

# CRM — Contacts & Companies

A CRM that "just works" (block type `contact`), built on the same polymorphic entity + property system as Tasks. Records are created automatically from email activity, so it stays populated without manual entry.

## Entity types

- **Contact** (a person) and **Company** (an organization). Both can relate to Projects, Channels, Chats, Documents, Users, Threads, and Tasks.

## Contact fields (built-in)

- Email, Name, Company (parent), First Interaction, Last Interaction, Created/Updated, Hidden (admin-only visibility).

## Company fields (built-in)

- Name and Description (resolved from the domain directory), Team, Domains (primary first), embedded Contacts list (permission-filtered), Email Sync toggle, Hidden, Created/Updated.

## Custom properties — supported types

Contacts, companies, tasks, and other entities all support these property data types:

- **STRING** (text) — e.g. phone, job title, department, notes.
- **NUMBER** — e.g. revenue, employee count, ARR.
- **BOOLEAN** — toggles.
- **DATE** — e.g. last contacted, contract/renewal date.
- **SELECT_STRING** — single/multi-select with string options (with custom option colors/icons).
- **SELECT_NUMBER** — single/multi-select with numeric options.
- **ENTITY** — reference to another entity (User, Company, Contact, Document, Project, Channel, Chat, Task, Thread).
- **LINK** — URLs (website, LinkedIn, etc.).

Property editors come in inline (click-to-edit), popover, and modal (batch) forms; properties can be system (non-removable) or custom, and metadata properties stay out of the main views.

## Auto-creation & enrichment

- Receiving or sending email auto-creates the contact and its company, links them, and updates first/last interaction timestamps.
- Company name/description enrich from the domain directory; contact display names derive from email addresses.

## Views, filtering, comments

- Records appear in the unified list views with filtering (by company, by interaction, hidden status, email-sync status).
- Threaded comments on contacts/companies.
- Hidden records are filtered out for non-admins.

## Integrations

- **Email:** the primary data source — contacts/companies link to threads; per-company email sync controls what flows in.
- **Mentions:** contacts and companies are @mentionable in docs, channels, and chats (rendered distinctly for people vs. companies).
- **Tasks:** tasks can reference contacts/companies via ENTITY properties.
- **Agents:** readable/writable through the entity property tools (`GetEntityProperties`, `SetEntityProperty`, `ListEntities`).

---

# Calls

Video calls with transcription and AI summaries that live inside Macro and feed team-level memory.

> Start from the Calls tab or the call button inside a channel. (Behind the `ENABLE_CALLS` flag.)

## During a call

- Ring notification to participants; audio/video toggle, mute, screen share, participants panel.
- **Team-sharing toggle** — by default a call is shared to the whole team's memory; uncheck (bottom-left of an active call, or in the side panel) to keep it in your personal memory only.

## After a call

- Recording playback with standard controls and a poster image.
- **Transcript** with speaker diarization (Speaker #1/#2…), timestamps, and grouping within 5-minute windows; click any line to seek the video; "sync to video time" to re-follow.
- **AI summary** auto-generated in markdown once the call ends.
- Side panel shows owner, start/end, duration, status, participants (click a participant to DM), and References.

## Integrations

- **Channels:** start/join calls in-channel; calls show in the channel's Call History.
- **Search:** transcripts and summaries are full-text searchable (when team-shared).
- **Agents:** the agent can search and summarize across call transcripts.
- **Docs:** call blocks embed in markdown (via a `call_transcript_id` param).
- **Inbox:** calls are intentionally **excluded** from the unified inbox view.

---

# Canvas

Infinite-canvas diagrams / whiteboard. Collaborative and embeddable in docs.

> Create with `c` then `n`.

## Tools

- Select, freehand pencil, shapes (rectangle, ellipse), pan/hand, zoom.
- **Connectors:** straight, flow (smooth bezier), and bent (orthogonal/stepped); end styles include arrow, filled arrow, circle, small circle, or none.
- Color swatches for stroke/fill; text properties (font family, size, color).
- Content nodes — text, image, file, and video nodes — are feature-flagged (`ENABLE_CANVAS_TEXT/IMAGES/FILES/VIDEO`).

## Collaboration & files

- Live multi-user sync (CRDT, debounced autosave), undo/redo.
- Share a link that captures the current viewport (x/y/scale). Download/export the canvas.

## Integrations

- **Docs:** embeds read-only inside markdown.
- **References / sharing / search** like every block.

---

# Code

Code files with syntax highlighting (CodeMirror 6) and autosave.

> Create with `c` then `o`.

## Languages & editing

- Highlighting for JavaScript (`.js/.mjs/.cjs`), TypeScript (`.ts/.cts/.mts`), JSX/TSX, HTML, CSS/SCSS/Sass/Less, JSON/JSONC, Python, Rust, C, and C++ (broad extension coverage); plain text/CSV fallback.
- Tab/indent management, toggle line comments (`cmd+/`), read-only when you lack edit access.
- Autosave (debounced 500 ms, throttled 5 s).
- **HTML render mode** — `.html` files toggle between code and a live preview (runs in-context, not sandboxed).

## Integrations

- **Docs:** code embeds read-only in markdown with highlighting.
- References, sharing, download like every block.

---

# PDF

PDF (and DOCX-as-PDF) viewing with markup, search, and agent Q&A. Uses a Macro fork of PDF.js.

## Viewing

- Multi-page rendering; jump to a page; up to 8 labeled tabs to hold positions within one PDF.
- Full-text search (`cmd+f`, regex, match count, next/prev).
- AI-generated table of contents when structure allows; click-to-define term lookup popups.

## Markup (flag: `ENABLE_PDF_MARKUP`)

- Text highlights (custom colors), freehand annotations, text boxes, signature fields.
- Comment threads anchored to highlights/areas (reply, edit/delete your own). Highlights/comments sync across collaborators (live tracking).

## Export

- Download with annotations/highlights applied (comments exported alongside); print (`cmd+p`).

## Integrations

- **Agents:** "Chat with agent" opens Q&A over the PDF's contents.
- **Docs:** embeds read-only in markdown (markup disabled when nested). Multisplit with other PDFs is flag-gated.
- References, sharing like every block.

---

# Image

Image viewing.

- **Formats:** PNG, JPEG, GIF, SVG, WebP.
- Aspect-preserving display (object-fit: contain); copy to clipboard (`cmd+c`); download; share.
- References and details panel like every block.

---

# Video

Video file viewing (distinct from Calls).

- **Formats:** MP4, MKV, WebM, AVI, MOV, WMV, MPEG/MPG, M4V, FLV, F4V, 3GP — native HTML5 player.
- Standard controls, autoplay, secure presigned streaming; download (with progress) and share.
- References and details panel. (Behind `ENABLE_VIDEO_BLOCK`.)

---

# Unknown / other files

Fallback for any file type without a dedicated viewer.

- Shows "No preview available for [filename]" with prominent **Download** and **Share** buttons.
- Still carries a details panel and References, so unsupported files remain shareable, linkable, and searchable by name/metadata like every other block.
