//! Chat message types. The role and content live in `chat_message`, so crates
//! that only store messages need not depend on `agent`; a [`ChatMessage`]
//! adds the resolved attachments the loop sends to the model.

use attachment::Attachments;
pub use chat_message::{AssistantMessagePart, ChatMessageContent, Role};

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

/// A single chat message with its role, content, and optional attachments.
#[derive(Debug)]
pub struct ChatMessage {
    /// The content of the message.
    pub content: ChatMessageContent,
    /// Which participant produced this message.
    pub role: Role,
    /// Resolved attachments (if any) associated with this message.
    pub attachments: Option<Attachments<'static>>,
}

// ---------------------------------------------------------------------------
// ChatMessages
// ---------------------------------------------------------------------------

/// A sequence of [`ChatMessage`]s.
#[derive(Debug)]
pub struct ChatMessages(pub Vec<ChatMessage>);

impl ChatMessages {
    /// Borrow the inner slice.
    pub fn as_slice(&self) -> &[ChatMessage] {
        &self.0
    }
}

impl From<Vec<ChatMessage>> for ChatMessages {
    fn from(v: Vec<ChatMessage>) -> Self {
        Self(v)
    }
}

impl std::ops::Deref for ChatMessages {
    type Target = [ChatMessage];
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
