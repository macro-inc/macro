#[cfg(test)]
mod test;

use agent_runtime_protocol::domain::action::{AgentAction, AgentPromptAction};
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSession, AgentSessionId, CreateAgentSessionParams};
use agent_session::domain::ports::{AgentSessionLogRepo, AgentSessionRepo};
use agent_session::domain::service::AgentSessionService;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::containers::ContainerManager;
use crate::domain::error::{HarnessError, Result};

/// Where a mention happened: everything the session row and the announcement
/// need, in domain vocabulary. The Kafka adapter builds this from the broker
/// event; nothing here names a broker type.
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
    /// The session to feed.
    pub session_id: AgentSessionId,
    /// Who sent it, when it came from a user.
    pub sender: Option<MacroUserIdStr<'static>>,
    /// The message text, verbatim.
    pub content: String,
}

/// Posts the one link message into the thread the mention came from.
///
/// Exactly one message per session: the pointer to its dedicated channel.
/// Progress, output, and errors belong to the session's own channel, not the
/// busy origin thread.
pub trait SessionAnnouncer: Send + Sync + 'static {
    /// Announce `session` as the answer to `origin`.
    fn announce(
        &self,
        session: &AgentSession,
        origin: &MentionOrigin,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Session-row values that are deployment configuration until they become
/// per-request data: which model, which harness, which repository.
#[derive(Debug, Clone)]
pub struct SessionDefaults {
    /// Model slug, e.g. `claude`.
    pub model: String,
    /// Harness slug, e.g. `opencode`.
    pub harness: String,
    /// Repository sessions run against.
    pub repo_url: String,
}

/// Turns trigger commands into running, announced agent sessions.
pub struct AgentHarnessService<Sessions, Logs, Containers, Announcer> {
    sessions: AgentSessionService<Sessions, Logs>,
    containers: Containers,
    announcer: Announcer,
    defaults: SessionDefaults,
}

impl<Sessions, Logs, Containers, Announcer>
    AgentHarnessService<Sessions, Logs, Containers, Announcer>
where
    Sessions: AgentSessionRepo,
    Logs: AgentSessionLogRepo + Clone,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
{
    /// Build the orchestrator from its ports.
    pub fn new(
        sessions: AgentSessionService<Sessions, Logs>,
        containers: Containers,
        announcer: Announcer,
        defaults: SessionDefaults,
    ) -> Self {
        Self {
            sessions,
            containers,
            announcer,
            defaults,
        }
    }

    /// Create a new agent session and reply to the mention with a pointer to its
    /// dedicated channel.
    #[tracing::instrument(err, skip(self, command), fields(
        bot_id = %command.bot_id,
        message_id = %command.origin.message_id,
    ))]
    pub async fn open(&self, command: OpenSession) -> Result<AgentSessionId> {
        let OpenSession { bot_id, origin } = command;
        let id = AgentSessionId::new();

        // The container comes up before the session exists anywhere: the
        // session row is the commitment that a session is real, so nothing
        // observable happens until there is a transport for it.
        let container = self.containers.spawn(id).await?;

        let session = self
            .sessions
            .create(
                CreateAgentSessionParams {
                    id,
                    owner_id: origin.sender.clone(),
                    bot_id,
                    thread_id: Some(origin.thread_id),
                    originating_message_id: Some(origin.message_id),
                    model: self.defaults.model.clone(),
                    harness: self.defaults.harness.clone(),
                    repo_url: self.defaults.repo_url.clone(),
                },
                container,
            )
            .await?;

        self.announcer
            .announce(&session, &origin)
            .await
            .map_err(HarnessError::Announce)?;

        self.sessions
            .send_message(id, Some(origin.sender), prompt(origin.content))
            .await?;
        Ok(id)
    }

    /// Deliver a message to an existing session, restoring its container
    /// when no live transport exists.
    #[tracing::instrument(err, skip(self, command), fields(session_id = %command.session_id))]
    pub async fn forward(&self, command: ForwardMessage) -> Result<()> {
        let ForwardMessage {
            session_id,
            sender,
            content,
        } = command;
        let action = prompt(content);

        match self
            .sessions
            .send_message(session_id, sender.clone(), action.clone())
            .await
        {
            Err(AgentSessionError::Disconnected(_)) => {
                todo!("resuming containers not implemented yet")
            }
            result => Ok(result?),
        }
    }
}

fn prompt(content: String) -> AgentAction {
    AgentAction::Prompt(AgentPromptAction { prompt: content })
}
