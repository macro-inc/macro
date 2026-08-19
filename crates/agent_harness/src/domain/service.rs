#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{
    AgentSessionId, AuthorKind, CreateAgentSessionParams, MessageId,
};
use agent_session::domain::ports::{AgentSessionNotificationRecipient, ControlEvent};
use agent_session::domain::service::AgentSessionService;
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{mpsc, oneshot};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    AnnounceOrigin, DeliverAction, HarnessCommand, OpenSession, SessionAnnouncement,
    SessionDefaults, SpawnContainer,
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

/// The harness is what holds a session's live resources, so it is what the
/// control routes notify. Both operations go through the per-session queue, so
/// a teardown cannot land in the middle of an open and a model change cannot
/// overtake the prompt it was meant to follow.
impl<Sessions, Containers, Announcer> AgentSessionNotificationRecipient
    for AgentHarnessService<Sessions, Containers, Announcer>
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
{
    async fn session_deleted(
        &self,
        id: AgentSessionId,
    ) -> agent_session::domain::error::Result<()> {
        self.execute(id, HarnessCommand::Delete)
            .await
            .map_err(into_session_error)
    }

    async fn control_event(
        &self,
        id: AgentSessionId,
        event: ControlEvent,
    ) -> agent_session::domain::error::Result<AgentActionId> {
        let action_id = AgentActionId::mint();
        self.execute(
            id,
            HarnessCommand::Deliver(DeliverAction::control(action_id.clone(), event)),
        )
        .await
        .map_err(into_session_error)?;
        Ok(action_id)
    }
}

/// Collapse a harness failure back into the session vocabulary the port speaks.
///
/// A harness error that started life as a session error is unwrapped rather
/// than re-wrapped, so a caller still sees `Disconnected` as `Disconnected`.
fn into_session_error(error: HarnessError) -> AgentSessionError {
    match error {
        HarnessError::Session(error) => error,
        other => AgentSessionError::Unknown(anyhow::anyhow!(other)),
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
            HarnessCommand::Deliver(command) => self.deliver(session_id, command).await,
            HarnessCommand::Delete => self.delete(session_id).await,
        }
    }

    /// Release everything the session holds, then delete it.
    ///
    /// The durable delete goes last on purpose. Crashing between the two
    /// leaves a session whose container is gone, which `resume` heals by
    /// spawning a new one; the other order leaves a paid sandbox that nothing
    /// knows to reap.
    #[tracing::instrument(err, skip(self), fields(%session_id))]
    async fn delete(&self, session_id: AgentSessionId) -> Result<()> {
        self.sessions.close_session(session_id).await?;
        self.containers.teardown(session_id).await?;
        self.sessions.delete_session(session_id).await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, command), fields(
        %session_id,
        bot_id = %command.bot_id,
        message_id = %command.origin.message_id,
    ))]
    async fn open(&self, session_id: AgentSessionId, command: OpenSession) -> Result<()> {
        let OpenSession { bot_id, origin } = command;
        let repo_url = self.defaults.repo_url.clone();

        self.sessions
            .create_session(CreateAgentSessionParams {
                id: session_id,
                owner_id: origin.sender.clone(),
                bot_id,
                thread_id: Some(origin.thread_id),
                originating_message_id: Some(origin.message_id),
                model: self.defaults.model.clone(),
                harness: self.defaults.harness.clone(),
                repo_url: repo_url.clone(),
            })
            .await?;

        self.announcer
            .announce(SessionAnnouncement {
                session_id,
                origin_channel_id: origin.channel_id,
                origin_thread_id: origin.thread_id,
                prompted_message_id: MessageId::first(AuthorKind::User),
                prompted_content: origin.content.clone(),
                triggered_by: origin.sender.clone(),
            })
            .await?;

        let container = self
            .containers
            .spawn(SpawnContainer {
                session_id,
                repo_url,
            })
            .await?;
        self.sessions.attach_session(session_id, container).await?;
        self.sessions
            .send_action(
                session_id,
                Some(origin.sender),
                AgentAction::prompt(origin.content),
                AgentActionId::mint(),
            )
            .await?;
        Ok(())
    }

    /// Do one thing in a session that already exists.
    ///
    /// Three steps, in this order: persist whatever the action changes about
    /// the session, work out whether anyone needs telling, then deliver it.
    /// Announcing last means nothing is announced that was never sent.
    #[tracing::instrument(err, skip(self, command), fields(%session_id))]
    async fn deliver(&self, session_id: AgentSessionId, command: DeliverAction) -> Result<()> {
        let DeliverAction {
            id,
            action,
            actor,
            announce,
        } = command;

        let announcement = self
            .announcement(session_id, &action, actor.as_ref(), announce)
            .await?;

        match self
            .sessions
            .send_action(session_id, actor.clone(), action.clone(), id.clone())
            .await
        {
            Ok(()) => {}
            // Nothing is attached, so bring the container back and retry the
            // action against the new connection. Same id: the first attempt
            // never reached the wire.
            Err(AgentSessionError::Disconnected(_)) => {
                let container = self.containers.resume(session_id).await?;
                self.sessions.attach_session(session_id, container).await?;
                self.sessions
                    .send_action(session_id, actor, action, id)
                    .await?;
            }
            Err(error) => return Err(error.into()),
        }

        if let Some(announcement) = announcement {
            self.announcer.announce(announcement).await?;
        }
        Ok(())
    }

    /// Who, if anyone, should be told that this landed.
    ///
    /// Only prompts are announced, and only when the caller named an origin
    /// to answer back into. A session has no channel of its own, so an origin
    /// is never redundant.
    async fn announcement(
        &self,
        session_id: AgentSessionId,
        action: &AgentAction,
        actor: Option<&MacroUserIdStr<'static>>,
        announce: Option<AnnounceOrigin>,
    ) -> Result<Option<SessionAnnouncement>> {
        let (Some(origin), Some(triggered_by), AgentAction::Prompt(prompt)) =
            (announce, actor, action)
        else {
            return Ok(None);
        };

        Ok(Some(SessionAnnouncement {
            session_id,
            origin_channel_id: origin.channel_id,
            origin_thread_id: origin.thread_id,
            prompted_message_id: self.sessions.next_prompt_message_id(session_id).await?,
            prompted_content: prompt.prompt.clone(),
            triggered_by: triggered_by.clone(),
        }))
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
