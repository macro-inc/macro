//! Port definitions for channel bot domain dependencies.

use async_trait::async_trait;
use channels::domain::side_effects::ChannelBotTrigger;
use entity_access::domain::models::EntityAccessReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{models::MessageParent, service::MessageWrite};

use super::models::{BotInvocation, TranscriptMessage};

/// Produces an assistant response for a channel message.
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

/// Decides whether a candidate channel message should invoke any bots.
#[async_trait]
pub trait TriggerDetector: Send + Sync {
    /// Resolve the bot invocations for a candidate message. An empty result
    /// means the message triggers nothing.
    async fn detect(&self, candidate: &ChannelBotTrigger) -> Vec<BotInvocation>;
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

/// Current parent capabilities for built-in agent replies.
#[async_trait]
pub trait ConversationAccess: Send + Sync {
    /// Mint Macro AI's write capability on behalf of the invoking user, immediately
    /// before a reply is persisted, so a revoked membership stops the reply.
    async fn bot_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report>;
}
