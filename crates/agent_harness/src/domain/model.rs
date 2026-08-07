//! Commands and values used by the harness domain.

use agent_session::domain::model::AgentSessionId;
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

/// Facts required to announce a newly created session.
#[derive(Debug, Clone)]
pub struct SessionAnnouncement {
    /// Channel containing the mention that opened the session.
    pub origin_channel_id: Uuid,
    /// Thread where the announcement should be posted.
    pub origin_thread_id: Uuid,
    /// Dedicated channel created for the agent session.
    pub session_channel_id: Uuid,
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
