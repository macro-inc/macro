//! MCP-only restatement of the document-content mention rule.
//!
//! The full Markdown-surface scope and `<m-document-mention>` tag rules live in
//! [`crate::mentions`], and already cover `CreateDocument`/`EditDocument`
//! content for in-app tool calls — [`crate::mentions`] composes into
//! [`crate::TOOL_USE_PROMPT`] via [`crate::BASE_PROMPT`], so nothing here is
//! needed there. But [`crate::mentions`] is deliberately excluded from the MCP
//! static instructions (see `MCP_STATIC_INSTRUCTIONS` in `lib.rs` and
//! [`crate::mcp_item_links`], which tells the model to link items in its own
//! MCP chat replies as plain Markdown URLs instead, since MCP clients can't
//! render the tag). This section exists solely to carry the document-content
//! mention rule into that MCP composition — without it, a document authored
//! over MCP would have no mention-tag rule to follow at all.
//!
//! It repeats the document-mention tag shape from [`crate::mentions`] rather
//! than importing it, so the two sections stay independently self-contained
//! even though they're composed into different prompts; `lib.rs`'s tests
//! assert the two occurrences don't diverge.

use crate::types::StaticPrompt;

static TITLE: &str = "Linking Macro items inside document content";

static INSTRUCTIONS: &str = r##"`CreateDocument` content (the `fileContent` argument) is rendered with the same Markdown parser used for chat responses, channel messages, and email bodies inside the Macro app — but only for Markdown (`.md`) documents. Non-Markdown documents (e.g. PDF, CSV, PNG, XLSX, DOCX, created by passing a non-`md` `file_extension`) are stored as raw file bytes and must never contain Markdown syntax or mention tags.

For Markdown document content, link to other Macro documents, channels, chats, projects, tasks, or email threads using `<m-document-mention>` XML mention tags, e.g.:

`<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>`

This holds true even when `CreateDocument` is called through the MCP server, where you are otherwise told to link items in your own chat replies as plain Markdown URLs — that rule is about your conversational responses to the MCP client, not about content you write into a Macro document. Do NOT use plain Markdown links or bare URLs to reference other Macro items inside document content; only `<m-document-mention>` tags render as working links there.

The same applies to `EditDocument`: when its `instructions` ask for a mention or document-card, include the referenced item's id and name so the editing worker can construct the correct in-app markup itself.
"##;

static INTENT: &str = "Content written into Markdown documents via CreateDocument or EditDocument \
links other Macro items with `<m-document-mention>` XML tags — never plain Markdown URLs — \
regardless of whether the tool call arrived in-app or over MCP, while non-Markdown documents carry \
no Markdown syntax or mention tags at all.";

/// The document-content linking prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
