use agent::types::ChatMessageContent;
use attachment::FormattedParts;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::{ChatMessageWithAttachments, NewChatMessage};
use std::future::Future;

use crate::domain::models::{PatchChatMessageArgs, ResolvedMessageContent, Result, WebCitation};

/// Repository trait for low-level message data access.
pub trait MessageRepo: Send + Sync + 'static {
    /// Create a new message in a chat, returning the message ID.
    fn create(
        &self,
        chat_id: &str,
        message: NewChatMessage,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Delete a message by ID.
    fn delete(&self, message_id: &str) -> impl Future<Output = Result<()>> + Send;

    /// Get all messages for a chat, with attachment metadata.
    fn get_messages(
        &self,
        chat_id: &str,
    ) -> impl Future<Output = Result<Vec<ChatMessageWithAttachments>>> + Send;

    /// Get the content of a single message by ID, scoped to a chat.
    fn get_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> impl Future<Output = Result<ChatMessageContent>> + Send;

    /// Update the content of a message.
    fn update_message_content(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Patch a message's content.
    fn patch_message(
        &self,
        chat_id: &str,
        args: PatchChatMessageArgs,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Copy all messages from one chat to another.
    fn copy_messages(
        &self,
        source_chat_id: &str,
        dest_chat_id: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Get web citations for a chat, grouped by message ID.
    fn get_web_citations(
        &self,
        chat_id: &str,
    ) -> impl Future<Output = Result<Vec<(String, Vec<WebCitation>)>>> + Send;

    /// Store the resolved (AI-facing) representation of a user message.
    fn store_resolved_message(
        &self,
        message_id: &str,
        parts: FormattedParts,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Get the resolved representation of a user message, if it exists.
    fn get_resolved_message(
        &self,
        message_id: &str,
    ) -> impl Future<Output = Result<FormattedParts>> + Send;
}

/// Service trait for message business logic.
///
/// Handlers depend on this trait rather than [`MessageRepo`] directly.
/// Access control is the caller's responsibility.
pub trait MessageService: Send + Sync + 'static {
    /// Create a message, resolve its attachments, store both, and return the result.
    fn create(
        &self,
        user_id: &MacroUserIdStr<'_>,
        chat_id: &str,
        message: NewChatMessage,
    ) -> impl Future<Output = Result<ResolvedMessageContent>> + Send;

    /// Store a message without resolving attachments.
    fn store(
        &self,
        chat_id: &str,
        message: NewChatMessage,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Update the content of a message.
    fn update(
        &self,
        user_id: &MacroUserIdStr<'_>,
        chat_id: &str,
        message_id: &str,
        content: &ChatMessageContent,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Delete a message by ID.
    fn delete(&self, message_id: &str) -> impl Future<Output = Result<()>> + Send;

    /// Get the resolved (AI-facing) representation of a user message.
    fn get_resolved_message(
        &self,
        message_id: &str,
    ) -> impl Future<Output = Result<ResolvedMessageContent>> + Send;

    /// Get all resolved messages for a chat, in order.
    fn get_resolved_message_chain(
        &self,
        chat_id: &str,
    ) -> impl Future<Output = Result<Vec<ResolvedMessageContent>>> + Send;
}
