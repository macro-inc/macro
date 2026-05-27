use agent::types::ChatMessageContent;
use attachment::FormattedParts;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Arguments for patching a chat message's content.
#[derive(Debug)]
pub struct PatchChatMessageArgs {
    /// The message ID to patch.
    pub message_id: String,
    /// The new content for the message.
    pub content: ChatMessageContent,
}

/// A web citation associated with a chat message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema, Default)]
pub struct WebCitation {
    /// The URL of the citation.
    pub url: String,
    /// The title of the cited page.
    pub title: String,
    /// A description of the cited page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The URL of the page's image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// The URL of the page's favicon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
}

/// The AI-facing representation of a user message, stored alongside the raw message.
#[derive(Debug)]
pub struct ResolvedMessageContent {
    /// The ID of the raw `ChatMessage` this resolves.
    pub message_id: String,
    /// The resolved attachment content, if the message had attachments.
    pub parts: Option<FormattedParts>,
}
