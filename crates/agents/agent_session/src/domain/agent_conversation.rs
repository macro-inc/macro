//! An agent's conversation in a channel, and the sessions it runs on.

use bot_id::BotId;
use macro_uuid::Uuid;

use super::{error::Result, model::AgentSessionId};

/// One agent persona's conversation in one channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AgentConversation {
    /// Channel the conversation happens in.
    pub channel_id: Uuid,
    /// Persona that answers there.
    pub bot_id: BotId,
}

/// A session a conversation has run on. Starting fresh begins another; the
/// channel keeps every earlier message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationSession {
    /// Session carrying this context and its controls.
    pub session_id: AgentSessionId,
    /// When this context began; older channel messages remain visible.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Whether new messages go to this session.
    pub is_current: bool,
}

/// Session-domain persistence for a conversation's current and earlier sessions.
pub trait AgentConversationRepo: Send + Sync + 'static {
    /// Atomically reserve the current session identity, before runtime startup.
    /// Repeated or concurrent requests return the same id until an explicit reset.
    fn current_or_create(
        &self,
        conversation: AgentConversation,
    ) -> impl Future<Output = Result<AgentSessionId>> + Send;

    /// Return the current session without starting one.
    fn current(
        &self,
        conversation: AgentConversation,
    ) -> impl Future<Output = Result<Option<AgentSessionId>>> + Send;

    /// Start a new session while keeping every earlier one and its history.
    fn start_fresh(
        &self,
        conversation: AgentConversation,
    ) -> impl Future<Output = Result<AgentSessionId>> + Send;

    /// The conversation a session belongs to, including earlier sessions.
    fn conversation_for_session(
        &self,
        session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Option<AgentConversation>>> + Send;

    /// Every session the conversation has run on, oldest first, without
    /// starting a runtime.
    fn sessions(
        &self,
        conversation: AgentConversation,
    ) -> impl Future<Output = Result<Vec<ConversationSession>>> + Send;
}
