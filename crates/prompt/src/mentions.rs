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

static TITLE: &str = "Mentioning documents, channels, channel messages, chats, projects, email threads, and calendar events";

static INSTRUCTIONS: &str = r##"These rules apply everywhere you author Markdown in Macro: your own conversational replies (AI chat and agent session transcripts), `SendChannelMessage` content, `SendEmail` bodies, and `CreateDocument`/`EditDocument` content for Markdown (`.md`) documents. They do NOT apply to non-Markdown documents created via `CreateDocument` (e.g. PDF, CSV, PNG, XLSX, DOCX) — those are raw file bytes, never parsed as Markdown, and must never contain mention tags or Markdown syntax.

When referencing a document, channel, chat, project, email thread, or calendar event, use XML mention tags with a JSON payload.
The AI does not need to know the name — an empty string is fine and the frontend will resolve it.

- Document mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>`
- Channel mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"channel","blockParams":{}}</m-document-mention>`
- Channel message mention: `<m-document-mention>{"documentId":"{channel_id}","documentName":"","blockName":"channel","blockParams":{"channel_message_id":"{message_id}"}}</m-document-mention>`
- Chat mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"chat","blockParams":{}}</m-document-mention>`
- Project mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"project","blockParams":{}}</m-document-mention>`
- Task mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"task","blockParams":{}}</m-document-mention>`
- Email thread mention: `<m-document-mention>{"documentId":"{thread_id}","documentName":"","blockName":"email","blockParams":{}}</m-document-mention>`
- Calendar event mention: `<m-document-mention>{"documentId":"{event_id}","documentName":"","blockName":"calendar","blockParams":{}}</m-document-mention>`
- Calendar event occurrence mention: `<m-document-mention>{"documentId":"{event_id}","documentName":"","blockName":"calendar","blockParams":{"occurrenceKey":"{recurrence_id}"}}</m-document-mention>`

The `blockName` for an email thread is always exactly `email` — never `thread` or `email_thread`, which the frontend cannot resolve.
The `blockName` for a calendar event is always exactly `calendar` — never `calendar_event`, which the frontend cannot resolve. `documentId` is the `eventId` a calendar tool returned. To point at one instance of a recurring event, pass that occurrence's `recurrenceId` from ListCalendarEvents as the `occurrenceKey` block param; otherwise omit it and the mention previews the nearest instance. A calendar event mention resolves only for users who have that event on their own calendar.
When a tool returns both a channel id and a channel message id, link the specific message using the channel message mention format. Do not link only the channel unless you are referring to the whole channel.

### Example Response

If no inline or node ids are present:
"See the document for details<m-document-mention>{"documentId":"6a2b138d-dfbe-439a-a78b-282471a1e165","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>."
"##;

static INTENT: &str = "Entities and channel messages are referenced with correctly formatted \
<m-document-mention> XML tags using the right blockName and blockParams for each entity type, \
including exactly \"email\" for email threads, exactly \"calendar\" for calendar events, and \
channel_message_id for specific channel messages, \
across every Markdown surface (AI chat replies, agent session replies, channel messages, \
email bodies, and Markdown documents) — never inside non-Markdown documents.";

/// The entity-mention prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
