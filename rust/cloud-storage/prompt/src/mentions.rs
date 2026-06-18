//! Rules for mentioning entities with XML mention tags.

use crate::types::StaticPrompt;

static TITLE: &str =
    "Mentioning documents, channels, channel messages, chats, projects, and email threads";

static INSTRUCTIONS: &str = r##"When referencing a document, channel, chat, project, or email thread, use XML mention tags with a JSON payload.
The AI does not need to know the name — an empty string is fine and the frontend will resolve it.

- Document mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>`
- Channel mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"channel","blockParams":{}}</m-document-mention>`
- Channel message mention: `<m-document-mention>{"documentId":"{channel_id}","documentName":"","blockName":"channel","blockParams":{"channel_message_id":"{message_id}"}}</m-document-mention>`
- Chat mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"chat","blockParams":{}}</m-document-mention>`
- Project mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"project","blockParams":{}}</m-document-mention>`
- Task mention: `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"task","blockParams":{}}</m-document-mention>`
- Email thread mention: `<m-document-mention>{"documentId":"{thread_id}","documentName":"","blockName":"email","blockParams":{}}</m-document-mention>`

The `blockName` for an email thread is always exactly `email` — never `thread` or `email_thread`, which the frontend cannot resolve.
When a tool returns both a channel id and a channel message id, link the specific message using the channel message mention format. Do not link only the channel unless you are referring to the whole channel.

### Example Response

If no inline or node ids are present:
“See the document for details<m-document-mention>{“documentId”:”6a2b138d-dfbe-439a-a78b-282471a1e165”,”documentName”:””,”blockName”:”md”,”blockParams”:{}}</m-document-mention>.”
"##;

static INTENT: &str = "Entities and channel messages are referenced with correctly formatted \
<m-document-mention> XML tags using the right blockName and blockParams for each entity type, \
including exactly \"email\" for email threads and channel_message_id for specific channel messages.";

/// The entity-mention prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
