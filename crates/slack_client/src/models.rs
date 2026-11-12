//! Typed Slack objects as the web client sees them.

mod blocks;
mod conversation;
mod file;
mod message;
mod user;

pub use blocks::{
    Block, KnownBlock, RichTextElement, RichTextInline, RichTextListStyle, RichTextStyle,
};
pub use conversation::{Conversation, ConversationKind, ConversationText, FrozenReason};
pub use file::{File, FileAccess, FileMode};
pub use message::{Edited, LegacyAttachment, Message, MessageSubtype, Reaction};
pub use user::{BotProfile, EnterpriseUser, Team, TeamIcon, User, UserProfile};

/// Slack's cursor pagination block.
#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct ResponseMetadata {
    /// The cursor for the next page; empty or absent on the last page.
    #[serde(default)]
    pub next_cursor: Option<String>,
}

impl ResponseMetadata {
    /// The next page's cursor, if there is one.
    pub fn next_cursor(&self) -> Option<&str> {
        self.next_cursor.as_deref().filter(|cursor| !cursor.is_empty())
    }
}
