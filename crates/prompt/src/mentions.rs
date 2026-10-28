//! Rules for mentioning entities with XML mention tags, and the scope of
//! Macro's shared Markdown rendering.
//!
//! These rules apply everywhere the model authors Markdown in Macro: its own
//! conversational replies (AI chat and agent session transcripts),
//! `SendChannelMessage` content, `SendEmail` bodies, and
//! `CreateDocument`/`EditDocument` content for Markdown (`.md`) documents.
//! The one exclusion is non-Markdown documents created via `CreateDocument`
//! (e.g. PDF, CSV, PNG, XLSX, DOCX) — those are stored as raw file bytes and
//! never parsed as Markdown, so they take no Markdown syntax or mention tags.
//!
//! See [`crate::document_content_links`] for the narrower restatement of the
//! document-mention tag that keeps it working over MCP, where this section is
//! deliberately excluded because MCP clients can't render the tag in a chat
//! reply (see [`crate::mcp_item_links`]).

use crate::types::StaticPrompt;

static TITLE: &str = "Mentioning documents, people, dates, agent sessions, and other chips";

static INSTRUCTIONS: &str = r##"These rules apply everywhere you author Markdown in Macro: your own conversational replies (AI chat and agent session transcripts), `SendChannelMessage` content, `SendEmail` bodies, and `CreateDocument`/`EditDocument` content for Markdown (`.md`) documents. They do NOT apply to non-Markdown documents created via `CreateDocument` (e.g. PDF, CSV, PNG, XLSX, DOCX) — those are raw file bytes, never parsed as Markdown, and must never contain mention tags or Markdown syntax.

When referencing a Macro item, person, date/time, agent session, or other mentionable chip, use XML mention tags with a JSON payload. They render as clickable chips; never use plain Markdown links or bare names instead. Empty names and labels are fine; the frontend fills them in.

### Documents, channels, and similar items

Use `<m-document-mention>` with the right `blockName` (and `blockParams` when needed):

- Document mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>`
- Image document mention (a generated or uploaded picture): `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"image","blockParams":{}}</m-document-mention>`
- Channel mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"channel","blockParams":{}}</m-document-mention>`
- Channel message mention: `<m-document-mention>{"documentId":"{channel_id}","documentName":"","blockName":"channel","blockParams":{"channel_message_id":"{message_id}"}}</m-document-mention>`
- Project mention (a task project, i.e. an initiative): `<m-document-mention>{"documentId":"{initiative_id}","documentName":"","blockName":"initiative","blockParams":{}}</m-document-mention>`
- Folder mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"project","blockParams":{}}</m-document-mention>`
- Task mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"task","blockParams":{}}</m-document-mention>`
- Email thread mention: `<m-document-mention>{"documentId":"{thread_id}","documentName":"","blockName":"email","blockParams":{}}</m-document-mention>`
- Calendar event mention: `<m-document-mention>{"documentId":"{event_id}","documentName":"","blockName":"calendar","blockParams":{}}</m-document-mention>`
- Calendar event occurrence mention: `<m-document-mention>{"documentId":"{event_id}","documentName":"","blockName":"calendar","blockParams":{"occurrenceKey":"{recurrence_id}"}}</m-document-mention>`
- Skill mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"skill","blockParams":{}}</m-document-mention>`
- Call mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"call","blockParams":{}}</m-document-mention>`
- Automation mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"automation","blockParams":{}}</m-document-mention>`
- Routine mention: `<m-document-mention>{"documentId":"{id}","documentName":"{name}","blockName":"routine"}</m-document-mention>`
- Snippet mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"snippet","blockParams":{}}</m-document-mention>`
- CRM company mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"company","blockParams":{}}</m-document-mention>`
- CRM pipeline mention: `<m-document-mention>{"documentId":"{pipeline_id}","documentName":"","blockName":"pipeline","blockParams":{}}</m-document-mention>`
- Database mention: `<m-document-mention>{"documentId":"{database_id}","documentName":"","blockName":"database","blockParams":{}}</m-document-mention>`
- Form mention: `<m-document-mention>{"documentId":"{form_id}","documentName":"","blockName":"form","blockParams":{}}</m-document-mention>`

Exact `blockName`s, since any other value renders a broken or deleted chip:

- A database is `database` and a form is `form`, never `md` or `document`. A form chip opens the builder; link its `/respond` page as a plain URL when people should submit responses.
- A project is `initiative`, with the id from ListInitiatives or ReadInitiative; `project` means a folder. A CRM pipeline is `pipeline`.
- An email thread is `email`, never `thread` or `email_thread`. A calendar event is `calendar`, never `calendar_event`, with the `eventId` as `documentId`; add a recurring event's `recurrenceId` as `occurrenceKey` to target one occurrence. Channel members without the event see a read-only preview. Private and confidential events are never shared.
- When a tool returns a channel message id, mention that message, not just its channel.

### People, groups, dates, agent sessions, pull requests, and booking links

These use their own tags — never wrap them in `<m-document-mention>`:

- Person: `<m-user-mention>{"userId":"{id}","email":"{email}"}</m-user-mention>`
- Contact: `<m-contact-mention>{"contactId":"{id}","name":"{name}","emailOrDomain":"{email_or_domain}","isCompany":false}</m-contact-mention>`
- Group: `<m-group-mention>{"groupAlias":"{alias}"}</m-group-mention>`
- Date/time: `<m-date-mention>{"date":"{iso_datetime}","displayFormat":"{label}"}</m-date-mention>`
- Agent session: `<m-agent-session-mention>{"id":"{session_id}","label":""}</m-agent-session-mention>`
- GitHub pull request: `<m-pr-mention>{"url":"https://github.com/{owner}/{repo}/pull/{number}","label":""}</m-pr-mention>`, or `<m-pr-mention>{"id":"{id}","label":""}</m-pr-mention>` when a tool returned the PR's Macro id
- Booking link: `<m-booking-link-mention>{"profileId":"{profile_id}","slug":"{slug}","url":"https://macro.com/app/book/{profile_id}/{slug}","label":""}</m-booking-link-mention>` (`slug` optional when linking the profile page)

- Dates: prefer a date chip to a typed date. `date` is ISO 8601 and `displayFormat` is the label shown (e.g. "Mon, Dec 1, 2025", "Today", "3:00 PM"); no lookup needed.
- Pull requests and booking links: always a chip, never a Markdown link or bare URL. Leave `label` empty and do not repeat the number, title, or URL beside it. A PR chip takes any github.com pull request URL; a booking chip takes the shareable URL plus the `profileId` and `slug` from its `/app/book/{profileId}/{slug}` path. A PR chip you receive carries the PR's URL in `url`. Issues, commits, and other GitHub pages stay Markdown links.
- Agent sessions: only ids a tool returned. Add `"expanded":true` to insert the live card (Magic Chip) instead of the compact title.
- Connecting apps: when a tool result hands you an `<m-connect-app>{"appSlug":"...","name":"..."}</m-connect-app>` tag, include it verbatim; it renders a connect button. Never invent one. In agent sessions the button resumes the conversation once connected, so just tell the user to connect; elsewhere, ask them to say when they have.

Only the tags listed here exist. Never invent a tag or put an id in the wrong one. Anything else, such as a `calendarId` from ListCalendars, is plain text: mention individual events, not calendars.

`EditDocument` takes no mention tags in `instructions`; pass each item's ids and details (userId/email, documentId/blockName, session id, ISO date and displayFormat, booking-link profileId/slug/url) so the editor inserts the chips.
"##;

static INTENT: &str = "Entities, people, dates, agent sessions, and other chips are referenced \
with the matching XML mention tag (m-document-mention with the right blockName/blockParams, \
m-user-mention, m-date-mention, m-agent-session-mention, m-pr-mention for GitHub pull \
requests by URL, m-booking-link-mention for Macro booking links by URL, and the other \
listed chip tags) across every Markdown surface (AI chat replies, agent session replies, channel messages, \
email bodies, and Markdown documents) — never inside non-Markdown documents, and never for \
ids outside the listed types (a calendar id from ListCalendars is not mentionable; \
only individual events are).";

/// The entity-mention prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
