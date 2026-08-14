//! Commands and values used by the harness domain.

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::model::{AgentSessionId, MessageId};
use agent_session::domain::ports::ControlEvent;
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

/// Where a prompt came from, when it came from somewhere the session should
/// answer back into.
#[derive(Debug, Clone)]
pub struct AnnounceOrigin {
    /// Channel the prompt was posted in.
    pub channel_id: Uuid,
    /// Thread the announcement replies into.
    pub thread_id: Uuid,
}

/// Do something in a session that already exists.
#[derive(Debug, Clone)]
pub struct DeliverAction {
    /// The id the action carries onto the wire, minted when it was accepted.
    /// A reconnect-and-retry resends under the same id.
    pub id: AgentActionId,
    /// What the agent is being asked to do.
    pub action: AgentAction,
    /// The user responsible, absent when nobody in particular is.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Where to announce this, for prompts that arrived from elsewhere.
    ///
    /// `None` means "do not announce": either the caller drove the session
    /// directly, so there is nowhere else to answer, or the action is not the
    /// kind anyone announces. A prompt posted into the session's own dedicated
    /// channel passes `Some`, and is still suppressed - the harness only
    /// learns the session's channel when it runs.
    pub announce: Option<AnnounceOrigin>,
}

/// One operation executed by the harness for an agent session.
///
/// Create, act, destroy. Everything that happens *within* a session's life is
/// a [`DeliverAction`], because the differences that used to justify separate
/// commands - whether to reconnect a dead session, whether to announce - are
/// properties of the action and its origin, not of the request that carried
/// it.
#[derive(Debug, Clone)]
pub enum HarnessCommand {
    /// Open a new session.
    Open(OpenSession),
    /// Act on a session that already exists.
    Deliver(DeliverAction),
    /// Release a session's live resources and delete it.
    Delete,
}

impl DeliverAction {
    /// A prompt from a user, arriving from a channel that may need answering.
    pub fn prompt(
        content: impl Into<String>,
        actor: Option<MacroUserIdStr<'static>>,
        announce: Option<AnnounceOrigin>,
    ) -> Self {
        Self {
            id: AgentActionId::mint(),
            action: AgentAction::prompt(content),
            actor,
            announce,
        }
    }

    /// A control request under a caller-visible id. Names no origin: whoever
    /// called the endpoint is looking at the session already.
    pub fn control(id: AgentActionId, event: ControlEvent) -> Self {
        Self {
            id,
            action: event.action,
            actor: event.actor,
            announce: None,
        }
    }
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
