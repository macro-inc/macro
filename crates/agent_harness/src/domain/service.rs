#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, CreateAgentSessionParams};
use agent_session::domain::service::AgentSessionService;
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use tokio::sync::{mpsc, oneshot};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    ForwardMessage, HarnessCommand, OpenSession, SessionAnnouncement, SessionDefaults,
    SpawnContainer,
};
use crate::domain::ports::{ContainerManager, SessionAnnouncer};

type SessionWorkers = DashMap<AgentSessionId, mpsc::UnboundedSender<QueuedCommand>>;

struct QueuedCommand {
    command: HarnessCommand,
    completed: oneshot::Sender<Result<()>>,
}

struct AgentHarnessInner<Sessions, Containers, Announcer> {
    sessions: Sessions,
    containers: Containers,
    announcer: Announcer,
    defaults: SessionDefaults,
}

/// Turns trigger commands into running, announced agent sessions.
pub struct AgentHarnessService<Sessions, Containers, Announcer> {
    inner: Arc<AgentHarnessInner<Sessions, Containers, Announcer>>,
    workers: Arc<SessionWorkers>,
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
            inner: Arc::new(AgentHarnessInner {
                sessions,
                containers,
                announcer,
                defaults,
            }),
            workers: Arc::new(DashMap::new()),
        }
    }

    /// Queue one command behind any work already running for its session.
    ///
    /// Queue admission happens synchronously so callers can spawn the returned
    /// completion future without reordering commands.
    pub fn execute(
        &self,
        session_id: AgentSessionId,
        mut command: HarnessCommand,
    ) -> impl Future<Output = Result<()>> + Send + 'static {
        let result = loop {
            let commands = self.commands(session_id);
            let (completed, result) = oneshot::channel();
            let queued = QueuedCommand { command, completed };

            match commands.send(queued) {
                Ok(()) => break result,
                Err(error) => {
                    command = error.0.command;
                    self.workers
                        .remove_if(&session_id, |_, current| current.same_channel(&commands));
                }
            }
        };

        async move {
            result
                .await
                .map_err(|_| HarnessError::CommandWorkerStopped(session_id))?
        }
    }

    fn commands(&self, session_id: AgentSessionId) -> mpsc::UnboundedSender<QueuedCommand> {
        match self.workers.entry(session_id) {
            Entry::Occupied(entry) => entry.get().clone(),
            Entry::Vacant(entry) => {
                let (commands, receiver) = mpsc::unbounded_channel();
                entry.insert(commands.clone());
                self.spawn_worker(session_id, receiver);
                commands
            }
        }
    }

    fn spawn_worker(
        &self,
        session_id: AgentSessionId,
        receiver: mpsc::UnboundedReceiver<QueuedCommand>,
    ) {
        tokio::spawn(run_session_worker(session_id, self.inner.clone(), receiver));
    }
}

impl<Sessions, Containers, Announcer> AgentHarnessInner<Sessions, Containers, Announcer>
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
{
    async fn execute(&self, session_id: AgentSessionId, command: HarnessCommand) -> Result<()> {
        match command {
            HarnessCommand::Open(command) => self.open(session_id, command).await,
            HarnessCommand::Forward(command) => self.forward(session_id, command).await,
        }
    }

    #[tracing::instrument(err, skip(self, command), fields(
        %session_id,
        bot_id = %command.bot_id,
        message_id = %command.origin.message_id,
    ))]
    async fn open(&self, session_id: AgentSessionId, command: OpenSession) -> Result<()> {
        let OpenSession { bot_id, origin } = command;
        let repo_url = self.defaults.repo_url.clone();

        // The container comes up before the session exists anywhere: the
        // session row is the commitment that a session is real, so nothing
        // observable happens until there is a transport for it.
        let container = self
            .containers
            .spawn(SpawnContainer {
                session_id,
                repo_url: repo_url.clone(),
            })
            .await?;

        let session = self
            .sessions
            .create_session(
                CreateAgentSessionParams {
                    id: session_id,
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
            .send_action(
                session_id,
                Some(origin.sender),
                AgentAction::prompt(origin.content),
            )
            .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, command), fields(%session_id))]
    async fn forward(&self, session_id: AgentSessionId, command: ForwardMessage) -> Result<()> {
        let ForwardMessage { sender, content } = command;
        let action = AgentAction::prompt(content);

        match self
            .sessions
            .send_action(session_id, sender.clone(), action.clone())
            .await
        {
            Ok(()) => return Ok(()),
            Err(AgentSessionError::Disconnected(_)) => {}
            Err(error) => return Err(error.into()),
        }

        let container = self.containers.resume(session_id).await?;
        self.sessions.attach_session(session_id, container).await?;
        self.sessions
            .send_action(session_id, sender, action)
            .await?;
        Ok(())
    }
}

async fn run_session_worker<Sessions, Containers, Announcer>(
    session_id: AgentSessionId,
    inner: Arc<AgentHarnessInner<Sessions, Containers, Announcer>>,
    mut receiver: mpsc::UnboundedReceiver<QueuedCommand>,
) where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
{
    while let Some(queued) = receiver.recv().await {
        let QueuedCommand { command, completed } = queued;
        let result = inner.execute(session_id, command).await;
        let _ = completed.send(result);
    }
}
