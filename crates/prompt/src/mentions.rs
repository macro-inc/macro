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

When referencing a Macro item, person, date/time, agent session, or other mentionable chip, use XML mention tags with a JSON payload. Those tags render as clickable chips. Do not use plain Markdown links or bare names for these. Empty name/label strings are fine — the frontend resolves them.

### Documents, channels, chats, and similar items

Use `<m-document-mention>` with the right `blockName` (and `blockParams` when needed):

- Document mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>`
- Channel mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"channel","blockParams":{}}</m-document-mention>`
- Channel message mention: `<m-document-mention>{"documentId":"{channel_id}","documentName":"","blockName":"channel","blockParams":{"channel_message_id":"{message_id}"}}</m-document-mention>`
- Chat mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"chat","blockParams":{}}</m-document-mention>`
- Project mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"project","blockParams":{}}</m-document-mention>`
- Task mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"task","blockParams":{}}</m-document-mention>`
- Email thread mention: `<m-document-mention>{"documentId":"{thread_id}","documentName":"","blockName":"email","blockParams":{}}</m-document-mention>`
- Calendar event mention: `<m-document-mention>{"documentId":"{event_id}","documentName":"","blockName":"calendar","blockParams":{}}</m-document-mention>`
- Calendar event occurrence mention: `<m-document-mention>{"documentId":"{event_id}","documentName":"","blockName":"calendar","blockParams":{"occurrenceKey":"{recurrence_id}"}}</m-document-mention>`
- Skill mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"skill","blockParams":{}}</m-document-mention>`
- Call mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"call","blockParams":{}}</m-document-mention>`
- Automation mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"automation","blockParams":{}}</m-document-mention>`
- Snippet mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"snippet","blockParams":{}}</m-document-mention>`
- CRM company mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"company","blockParams":{}}</m-document-mention>`

The `blockName` for an email thread is always exactly `email` — never `thread` or `email_thread`, which the frontend cannot resolve.
The `blockName` for a calendar event is always exactly `calendar` — never `calendar_event`, which the frontend cannot resolve. `documentId` is the `eventId` a calendar tool returned. To point at one instance of a recurring event, pass that occurrence's `recurrenceId` from ListCalendarEvents as the `occurrenceKey` block param; otherwise omit it and the mention previews the nearest instance. A calendar event mention resolves only for users who have that event on their own calendar.
When a tool returns both a channel id and a channel message id, link the specific message using the channel message mention format. Do not link only the channel unless you are referring to the whole channel.

### People, groups, dates, agent sessions, and pull requests

These use their own tags — never wrap them in `<m-document-mention>`:

- Person: `<m-user-mention>{"userId":"{id}","email":"{email}"}</m-user-mention>`
- Contact: `<m-contact-mention>{"contactId":"{id}","name":"{name}","emailOrDomain":"{email_or_domain}","isCompany":false}</m-contact-mention>`
- Group: `<m-group-mention>{"groupAlias":"{alias}"}</m-group-mention>`
- Date/time: `<m-date-mention>{"date":"{iso_datetime}","displayFormat":"{label}"}</m-date-mention>`
- Agent session: `<m-agent-session-mention>{"id":"{session_id}","label":""}</m-agent-session-mention>`
- Pull request: `<m-pr-mention>{"id":"{id}","label":""}</m-pr-mention>`

Date/time chips do not need a looked-up id. `date` is an ISO 8601 datetime; `displayFormat` is the chip label the user sees (e.g. "Mon, Dec 1, 2025", "Today", "Tomorrow", "3:00 PM"). Prefer a date chip over typing a date as plain text when you are naming a specific day or time.

Agent session chips reference an existing session by id from a tool result. An empty `label` is fine. Set `"expanded":true` to insert the card (Magic Chip) that follows the session's latest turn instead of the compact underlined title. Do not invent session ids.

If a tool result tells you an app is not connected for the person you are working for and hands you a `<m-connect-app>{"appSlug":"...","name":"..."}</m-connect-app>` tag, include that tag verbatim in your reply: it renders as a button that connects the app. Never invent one; only repeat the tag a tool result gave you. End that reply by asking them to let you know once they have connected the app so you can try again.

Only the tag formats listed here can be mentioned. Never invent a tag name or put an id in the wrong tag. A calendar itself is NOT a mentionable entity: never put a `calendarId` (e.g. from ListCalendars) in a mention tag — the frontend cannot resolve it and renders a broken chip. Refer to a calendar by name in plain text and mention only individual events on it. The same goes for any other id with no mention format listed here: plain text, never an improvised tag.

`EditDocument` does not take mention tags in `instructions`. Include each referenced item's ids and details (userId/email, documentId/blockName, session id, ISO date and displayFormat, and so on) so the editing worker can insert the chip itself.

### Example Response

If no inline or node ids are present:
"See the document for details<m-document-mention>{"documentId":"6a2b138d-dfbe-439a-a78b-282471a1e165","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>."
"##;

static INTENT: &str = "Entities, people, dates, agent sessions, and other chips are referenced \
with the matching XML mention tag (m-document-mention with the right blockName/blockParams, \
m-user-mention, m-date-mention, m-agent-session-mention, and the other listed chip tags) \
across every Markdown surface (AI chat replies, agent session replies, channel messages, \
email bodies, and Markdown documents) — never inside non-Markdown documents, and never for \
ids outside the listed types (a calendar id from ListCalendars is not mentionable; \
only individual events are).";

/// The entity-mention prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
