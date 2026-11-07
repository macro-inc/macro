//! Port definitions for built-in message agent dependencies.

use async_trait::async_trait;
use entity_access::domain::models::EntityAccessReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    events::MessagePostedMetadata, models::MessageParent, service::MessageWrite,
};

use super::models::{BotInvocation, MarkedPassage, TranscriptMessage};

/// Produces an assistant response for a posted message.
#[async_trait]
pub trait AgentResponder: Send + Sync {
    /// Run the agent on behalf of `user_id` with `prompt`, returning the reply.
    async fn respond(&self, user_id: &str, prompt: String) -> anyhow::Result<String>;
}

/// Resolves the time zone a user's schedule lives in.
#[async_trait]
pub trait UserTimeZones: Send + Sync {
    /// The IANA time zone of the user's primary calendar, `None` when no
    /// calendar is connected. Best effort: lookup failures resolve to `None`.
    async fn primary_time_zone(&self, user_id: &str) -> Option<String>;
}

/// Reads what a comment mark covers in the live document.
#[async_trait]
pub trait CommentMarks: Send + Sync {
    /// The mark as the document reads now, `None` when the document no longer
    /// carries it. Checks no access of its own: it is only asked after the
    /// thread was read under the invoking user's capability on the document.
    async fn resolve(
        &self,
        document_id: &str,
        mark_id: uuid::Uuid,
    ) -> anyhow::Result<Option<MarkedPassage>>;
}

/// Decides whether a committed post should invoke any bots.
#[async_trait]
pub trait TriggerDetector: Send + Sync {
    /// Resolve the bot invocations for a candidate message. An empty result
    /// means the message triggers nothing.
    async fn detect(&self, candidate: &MessagePostedMetadata) -> Vec<BotInvocation>;
}

/// Classifies whether a thread message expects an agent response without an
/// explicit mention.
#[async_trait]
pub trait InferredTriggerClassifier: Send + Sync {
    /// Whether the last message in `thread` (oldest-first) expects the agent
    /// to respond. `requesting_user` is the author of that message.
    async fn expects_response(
        &self,
        requesting_user: &MacroUserIdStr<'static>,
        thread: &[TranscriptMessage],
    ) -> anyhow::Result<bool>;
}

/// Current parent capabilities for built-in agent reads and replies.
#[async_trait]
pub trait ConversationAccess: Send + Sync {
    /// Verify the invoking user can still post to the parent. Context reads
    /// downgrade this to view access, so a user who may no longer write there
    /// gets no history read on their behalf either.
    async fn user_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report>;

    /// Mint Macro AI's write capability on behalf of the invoking user, immediately
    /// before a reply is persisted, so a revoked membership stops the reply.
    async fn bot_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report>;
}
