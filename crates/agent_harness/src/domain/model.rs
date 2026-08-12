//! Commands and values used by the harness domain.

use agent_session::domain::model::{AgentSessionId, MessageId};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// Where a mention happened.
#[derive(Debug, Clone)]
pub struct MentionOrigin {
    /// Channel the mentioning message was posted in.
    pub channel_id: Uuid,
    /// Thread the announcement replies into: the mention's thread root.
    pub thread_id: Uuid,
    /// The mentioning message itself.
    pub message_id: Uuid,
    /// Who asked. Owns the session and is credited for its messages.
    pub sender: MacroUserIdStr<'static>,
    /// The message text, verbatim; becomes the session's first prompt.
    pub content: String,
}

/// Open a new session for a mention.
#[derive(Debug, Clone)]
pub struct OpenSession {
    /// The bot that was mentioned.
    pub bot_id: BotId,
    /// The mention itself.
    pub origin: MentionOrigin,
}

/// Deliver a message to a session that already exists.
#[derive(Debug, Clone)]
pub struct ForwardMessage {
    /// Channel where this follow-up was posted.
    pub channel_id: Uuid,
    /// Thread where its Magic Chip should be posted.
    pub thread_id: Uuid,
    /// Who sent it, when it came from a user.
    pub sender: Option<MacroUserIdStr<'static>>,
    /// The message text, verbatim.
    pub content: String,
}

/// One operation executed by the harness for an agent session.
#[derive(Debug, Clone)]
pub enum HarnessCommand {
    /// Open a new session.
    Open(OpenSession),
    /// Feed a session that already exists.
    Forward(ForwardMessage),
}

/// Facts required to announce one prompt into its originating context.
#[derive(Debug, Clone)]
pub struct SessionAnnouncement {
    /// Agent session represented by the announcement.
    pub session_id: AgentSessionId,
    /// Channel containing the mention that opened the session.
    pub origin_channel_id: Uuid,
    /// Thread where the announcement should be posted.
    pub origin_thread_id: Uuid,
    /// Dedicated channel created for the agent session.
    pub session_channel_id: Uuid,
    /// Folded user message that prompts the anchored agent response.
    pub prompted_message_id: MessageId,
    /// Text of the prompting message, quoted back in the announcement.
    pub prompted_content: String,
    /// User whose mention triggered the announcement.
    pub triggered_by: MacroUserIdStr<'static>,
}

/// Values required to provision a new session container.
#[derive(Debug, Clone)]
pub struct SpawnContainer {
    /// Session that will own the container transport.
    pub session_id: AgentSessionId,
    /// Repository cloned into the container workspace.
    pub repo_url: String,
}

/// Session-row values that remain deployment configuration for now.
#[derive(Debug, Clone)]
pub struct SessionDefaults {
    /// Model slug, e.g. `claude`.
    pub model: String,
    /// Harness slug, e.g. `opencode`.
    pub harness: String,
    /// Repository sessions run against.
    pub repo_url: String,
}
