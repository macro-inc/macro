#[cfg(test)]
mod test;

use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, CreateAgentSessionParams};
use agent_session::domain::service::AgentSessionService;

use crate::domain::error::Result;
use crate::domain::model::{
    ForwardMessage, OpenSession, SessionAnnouncement, SessionDefaults, SpawnContainer,
};
use crate::domain::ports::{ContainerManager, SessionAnnouncer};

const RESUME_LOCKS: usize = 64;

/// Turns trigger commands into running, announced agent sessions.
pub struct AgentHarnessService<Sessions, Containers, Announcer> {
    sessions: Sessions,
    containers: Containers,
    announcer: Announcer,
    defaults: SessionDefaults,
    resume_locks: [tokio::sync::Mutex<()>; RESUME_LOCKS],
}

impl<Sessions, Containers, Announcer> AgentHarnessService<Sessions, Containers, Announcer>
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
{
    /// Build the orchestrator from its ports.
    pub fn new(
        sessions: Sessions,
        containers: Containers,
        announcer: Announcer,
        defaults: SessionDefaults,
    ) -> Self {
        Self {
            sessions,
            containers,
            announcer,
            defaults,
            resume_locks: std::array::from_fn(|_| tokio::sync::Mutex::new(())),
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
        let repo_url = self.defaults.repo_url.clone();

        // The container comes up before the session exists anywhere: the
        // session row is the commitment that a session is real, so nothing
        // observable happens until there is a transport for it.
        let container = self
            .containers
            .spawn(SpawnContainer {
                session_id: id,
                repo_url: repo_url.clone(),
            })
            .await?;

        let session = self
            .sessions
            .create_session(
                CreateAgentSessionParams {
                    id,
                    owner_id: origin.sender.clone(),
                    bot_id,
                    thread_id: Some(origin.thread_id),
                    originating_message_id: Some(origin.message_id),
                    model: self.defaults.model.clone(),
                    harness: self.defaults.harness.clone(),
                    repo_url,
                },
                container,
            )
            .await?;

        self.announcer
            .announce(SessionAnnouncement {
                origin_channel_id: origin.channel_id,
                origin_thread_id: origin.thread_id,
                session_channel_id: session.channel_id,
                triggered_by: origin.sender.clone(),
            })
            .await?;

        self.sessions
            .send_action(id, Some(origin.sender), AgentAction::prompt(origin.content))
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
        let action = AgentAction::prompt(content);

        let mut already_logged = match self
            .sessions
            .send_action(session_id, sender.clone(), action.clone())
            .await
        {
            Ok(()) => return Ok(()),
            Err(AgentSessionError::Disconnected(_)) => false,
            Err(AgentSessionError::DeliveryFailed(_)) => true,
            Err(error) => return Err(error.into()),
        };
        let lock = session_id.as_uuid().as_u128() as usize % RESUME_LOCKS;
        let _guard = self.resume_locks[lock].lock().await;

        let recheck = if already_logged {
            self.sessions
                .retry_action(session_id, sender.clone(), action.clone())
                .await
        } else {
            self.sessions
                .send_action(session_id, sender.clone(), action.clone())
                .await
        };
        match recheck {
            Ok(()) => return Ok(()),
            Err(AgentSessionError::Disconnected(_)) => {}
            Err(AgentSessionError::DeliveryFailed(_)) => already_logged = true,
            Err(error) => return Err(error.into()),
        }

        let container = self.containers.resume(session_id).await?;
        self.sessions.attach_session(session_id, container).await?;
        if already_logged {
            self.sessions
                .retry_action(session_id, sender, action)
                .await?;
        } else {
            self.sessions
                .send_action(session_id, sender, action)
                .await?;
        }
        Ok(())
    }
}
