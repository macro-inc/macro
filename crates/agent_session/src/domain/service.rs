//! Persistence and active lifecycle management for agent sessions.
//!
//! Inbound adapters depend on [`AgentSessionService`] rather than repository
//! ports. Protocol decisions live in [`super::session`]'s pure machine, and
//! each connection's effects are executed by its actor shell.
//!
//! A session's log is the only record of what it did: nothing mirrors it
//! anywhere else, and a reader gets the frames and folds them itself.
//!
//! A live session's log is written by its actor, which is handed a
//! [`LiveSessionLogWriter`] rather than the bare repository. Anyone writing a
//! run of frames in order has somewhere to keep state, so that writer holds an
//! `agent_fold` machine and pushes each frame into it - which is what keeps a
//! reconnecting session's [`TurnId`](agent_fold::domain::model::TurnId)s
//! counting from where the session actually is, rather than from zero. The
//! streamed chunks that make up most of a log cost one push and no I/O. That
//! is a session's actor, and equally `seed_jsonl` replaying a recording.
//!
//! [`LiveSessionLogWriter`] is also where a live session's frames are
//! streamed from, for the same reason: it is the one place every frame of a
//! connected session passes through, so anything a viewer should see as it
//! happens has to be published from there. The push cannot fail the durable
//! append - see [`AgentSessionRealtime`].

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionId;
use agent_fold::domain::fold::FoldMachineImpl;
use agent_fold::domain::ports::{FoldMachine, FoldedMessageRepo};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::{mpsc, oneshot};

use bots::domain::models::BotId;

use super::connection::RuntimeAttachment;
use super::error::{AgentSessionError, Result};
use super::model::{
    AgentSession, AgentSessionId, AgentSessionLog, AuthorKind, ChannelSession,
    CreateAgentSessionParams, LogAppended, Message, MessageId, SessionLog, StoredAgentSessionLog,
};
use super::ports::{
    AgentConnector, AgentSessionLogRepo, AgentSessionLogWriter, AgentSessionRealtime,
    AgentSessionRepo,
};
use super::session::actors::{SessionActor, SessionCommand, Stepped};

/// Buffered not-yet-accepted commands per session actor.
const COMMAND_BUFFER: usize = 1028;

type ActiveSessions = DashMap<AgentSessionId, mpsc::Sender<SessionCommand>>;

/// Durable and live use cases for agent sessions.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionService: Send + Sync + 'static {
    /// Persist a session before any transport is provisioned or attached.
    fn create_session(
        &self,
        params: CreateAgentSessionParams,
    ) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Get a persisted agent session by id.
    fn get_session(&self, id: AgentSessionId) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Delete an agent session by id.
    fn delete_session(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// Release this session's live transport, if it has one.
    ///
    /// The actor observes its command channel closing and winds itself down
    /// through the ordinary close path, so this is enough to end a connection;
    /// it does not touch anything durable. A session with no active transport
    /// is already in the state this asks for, so it succeeds.
    fn close_session(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// Attach a new transport to an existing persisted session.
    ///
    /// The attachment carries the connection's handshake gate as well as the
    /// transport, because whether this session runs `initialize` depends on
    /// whether another session on the same connection already did.
    fn attach_session<Connector>(
        &self,
        id: AgentSessionId,
        attachment: RuntimeAttachment<Connector>,
    ) -> impl Future<Output = Result<()>> + Send
    where
        Connector: AgentConnector;

    /// Deliver an action through the session's active transport, under the
    /// action id it will carry onto the wire.
    fn send_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
        action_id: AgentActionId,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The session an incoming channel context routes to, if any.
    fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> impl Future<Output = Result<ChannelSession>> + Send;

    /// The user-message id the next prompt appended to this session will fold to.
    fn next_prompt_message_id(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<MessageId>> + Send;

    /// The raw protocol log of one session, oldest first, with the agent
    /// whose messages it derives.
    ///
    /// Served unfolded because nothing here folds for a reader any more: the
    /// web client runs the same fold compiled to WASM, so a streamed session
    /// and a reloaded one are rendered by one implementation rather than two
    /// that have to be kept agreeing. See [`SessionLog`].
    fn session_log(&self, id: AgentSessionId) -> impl Future<Output = Result<SessionLog>> + Send;
}

/// Agent session service backed by one durable repository and local actors.
///
/// `R` is the persistence adapter implementing both [`AgentSessionRepo`] and
/// [`AgentSessionLogRepo`], e.g. `outbound::postgres::PgAgentSessionRepo`.
/// `Folds` answers "what messages does this session's log derive" -
/// `agent_fold` folding the log on read - and `Rt` streams each frame to
/// whoever is watching the session's channel right now.
pub struct AgentSessionServiceImpl<R, Folds, Rt> {
    repo: R,
    folds: Folds,
    realtime: Rt,
    active: Arc<ActiveSessions>,
}

impl<R, Folds, Rt> AgentSessionServiceImpl<R, Folds, Rt> {
    /// Build a service from its persistence port, fold, and realtime
    /// publisher.
    ///
    /// Only a live session streams, so a caller with no viewers to serve -
    /// tests, and offline tooling - passes
    /// [`NoOpRealtime`](super::ports::NoOpRealtime).
    pub fn new(repo: R, folds: Folds, realtime: Rt) -> Self {
        Self {
            repo,
            folds,
            realtime,
            active: Arc::new(DashMap::new()),
        }
    }

    fn register_transport<Connector>(
        &self,
        id: AgentSessionId,
        acp_session_id: Option<SessionId>,
        workspace: String,
        attachment: RuntimeAttachment<Connector>,
    ) -> Result<()>
    where
        R: AgentSessionRepo + AgentSessionLogRepo + Clone,
        Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
        Connector: AgentConnector,
    {
        let (commands, command_rx) = mpsc::channel(COMMAND_BUFFER);

        match self.active.entry(id) {
            Entry::Occupied(_) => return Err(AgentSessionError::AlreadyConnected(id)),
            Entry::Vacant(entry) => {
                entry.insert(commands.clone());
            }
        }

        // The actor owns this session's log writes, so it gets the live writer
        // rather than the bare repository - see module docs. Its fold starts
        // empty and catches itself up on the stored log on the first frame,
        // which costs an attach nothing until the session actually says
        // something.
        let logs = LiveSessionLogWriter::new(self.repo.clone(), self.realtime.clone());
        let actor = SessionActor::new(
            id,
            acp_session_id,
            workspace,
            attachment.connector,
            logs,
            command_rx,
            attachment.handshake,
        );
        tokio::spawn(run_session(actor, Arc::downgrade(&self.active), commands));
        Ok(())
    }

    async fn deliver_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
        action_id: AgentActionId,
    ) -> Result<()> {
        let commands = self
            .active
            .get(&id)
            .map(|entry| entry.value().clone())
            .ok_or(AgentSessionError::Disconnected(id))?;

        let (completed, result) = oneshot::channel();
        if commands
            .send(SessionCommand {
                user_id,
                action,
                action_id,
                completed,
            })
            .await
            .is_err()
        {
            self.active
                .remove_if(&id, |_, active| active.same_channel(&commands));
            return Err(AgentSessionError::Disconnected(id));
        }
        match result.await {
            Ok(result) => result,
            Err(_) => {
                self.active
                    .remove_if(&id, |_, active| active.same_channel(&commands));
                Err(AgentSessionError::Disconnected(id))
            }
        }
    }
}

impl<R, Folds, Rt> AgentSessionService for AgentSessionServiceImpl<R, Folds, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
    Folds: FoldedMessageRepo + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
{
    async fn create_session(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        AgentSessionRepo::create(&self.repo, params).await
    }

    async fn get_session(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.repo.get(id).await
    }

    async fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        self.repo.find_for_channel(thread_id, bot_id).await
    }

    async fn delete_session(&self, id: AgentSessionId) -> Result<()> {
        self.repo.delete(id).await
    }

    async fn close_session(&self, id: AgentSessionId) -> Result<()> {
        // Dropping the sender is the whole operation: the actor's next step
        // reads `None` from its command channel, treats it as `Abandoned`, and
        // tears the transport down on its way out.
        self.active.remove(&id);
        Ok(())
    }

    async fn attach_session<Connector>(
        &self,
        id: AgentSessionId,
        attachment: RuntimeAttachment<Connector>,
    ) -> Result<()>
    where
        Connector: AgentConnector,
    {
        let session = self.repo.get(id).await?;
        self.register_transport(
            session.id,
            session.acp_session_id,
            session.workspace,
            attachment,
        )
    }

    async fn send_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
        action_id: AgentActionId,
    ) -> Result<()> {
        self.deliver_action(id, user_id, action, action_id).await
    }

    async fn next_prompt_message_id(&self, id: AgentSessionId) -> Result<MessageId> {
        Ok(MessageId {
            turn: self.folds.next_turn_id(id).await?,
            author: AuthorKind::User,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn session_log(&self, id: AgentSessionId) -> Result<SessionLog> {
        let session = self.repo.get(id).await?;
        let entries = AgentSessionLogRepo::list_by_session(&self.repo, id).await?;
        Ok(SessionLog {
            bot: self.repo.session_bot(session.bot_id).await?,
            entries,
        })
    }
}

/// The [`AgentSessionLogRepo`] a session's actor writes through: the durable
/// append, then the push to whoever is watching the session right now.
///
/// This is also where a writer's fold lives, and the fold is what makes
/// re-attaching correct: [`TurnId`](agent_fold::domain::model::TurnId)s are a
/// counter over the log, so a connection has to know how far along the session
/// already is. Carrying the machine from frame to frame rather than refolding
/// the stored log per frame is what keeps that from being quadratic in the
/// length of the session.
///
/// Public because a session's actor is not the only thing that writes a run of
/// frames in order: `seed_jsonl` replays a whole recording, and wants the same
/// arithmetic rather than a refold per line.
pub struct LiveSessionLogWriter<R, Rt> {
    repo: R,
    realtime: Rt,
    fold: Option<FoldMachineImpl>,
}

impl<R, Rt> LiveSessionLogWriter<R, Rt> {
    /// A log writer that streams each frame it writes to whoever is watching
    /// the session.
    ///
    /// The fold starts empty and catches itself up on whatever is already
    /// stored when the first frame arrives, so this is cheap to build and
    /// correct against a session that already has a log.
    pub fn new(repo: R, realtime: Rt) -> Self {
        Self {
            repo,
            realtime,
            fold: None,
        }
    }
}

impl<R, Rt> AgentSessionLogWriter for LiveSessionLogWriter<R, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    async fn append(&mut self, log: AgentSessionLog) -> Result<()> {
        let session = log.agent_session_id;

        // The wire tap: every frame of every session, both directions,
        // crosses here exactly once. Enable with RUST_LOG=agent_session=trace.
        if tracing::enabled!(tracing::Level::TRACE) {
            let (direction, frame) = match &log.content {
                Message::ToServer(message) => ("to_server", serde_json::to_string(message)),
                Message::ToRuntime(message) => ("to_runtime", serde_json::to_string(message)),
            };
            tracing::trace!(
                %session,
                direction,
                frame = frame.as_deref().unwrap_or("<unserializable>"),
                "acp frame"
            );
        }

        // Durable first: projections are rebuildable, but a frame omitted from
        // session history is not.
        let stored = AgentSessionLogRepo::create(&self.repo, log.clone()).await?;

        if let Some(fold) = &mut self.fold {
            let _ = fold.push(log.clone());
        } else {
            match self.catch_up(session).await {
                Ok(fold) => self.fold = Some(fold),
                Err(error) => {
                    tracing::error!(
                        error = ?error,
                        %session,
                        "failed to fold agent session frame"
                    );
                }
            }
        }

        // Projected on every frame - idempotent, rebuildable from the log,
        // and best-effort like the stream below, so a failed write must not
        // fail the append. Batch if the write rate ever matters.
        if let Some(model) = self
            .fold
            .as_ref()
            .and_then(|fold| fold.metadata().model.clone())
            && let Err(error) = self.repo.set_model(session, &model).await
        {
            tracing::error!(
                error = ?error,
                %session,
                "failed to project agent session model"
            );
        }

        // Best-effort once the durable append has succeeded: the port drops
        // frames by contract, and the log this was derived from is already
        // durable, so the worst a failure costs is a viewer who has to reload.
        if let Err(error) = self.stream(session, stored).await {
            tracing::error!(
                error = ?error,
                %session,
                "failed to stream agent session frame"
            );
        }
        Ok(())
    }
}

/// Pure delegation to the wrapped repository: the actor's shutdown path reads
/// and updates the session through its `Logs` handle, and those operations
/// append nothing, so there is nothing for this writer to do with them.
impl<R, Rt> AgentSessionRepo for LiveSessionLogWriter<R, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    async fn create(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        AgentSessionRepo::create(&self.repo, params).await
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.repo.get(id).await
    }

    async fn session_bot(
        &self,
        id: bots::domain::models::BotId,
    ) -> Result<super::model::SessionBot> {
        self.repo.session_bot(id).await
    }

    async fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<bots::domain::models::BotId>,
    ) -> Result<super::model::ChannelSession> {
        self.repo.find_for_channel(thread_id, bot_id).await
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        self.repo.set_acp_session_id(id, acp_session_id).await
    }

    async fn set_model(&self, id: AgentSessionId, model: &str) -> Result<()> {
        self.repo.set_model(id, model).await
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        self.repo.delete(id).await
    }
}

impl<R, Rt> LiveSessionLogWriter<R, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo,
    Rt: AgentSessionRealtime,
{
    /// Push the frame just appended out to whoever is watching the session.
    async fn stream(
        &mut self,
        agent_session_id: AgentSessionId,
        entry: StoredAgentSessionLog,
    ) -> std::result::Result<(), rootcause::Report> {
        self.realtime
            .publish(LogAppended {
                agent_session_id,
                entry,
            })
            .await
    }

    /// Walk this connection's fold through the session's stored log, so it
    /// starts from where the session actually is rather than from nothing.
    ///
    /// Runs once per connection, on its first frame - by which point that
    /// frame is already in the log, so replaying the log folds it too and the
    /// caller must not push it again.
    ///
    /// This is what makes re-attaching correct.
    /// [`TurnId`](agent_fold::domain::model::TurnId)s are a counter over the
    /// log, so a fold starting empty would hand `TurnId(0)` to the next prompt
    /// of a session already five turns in - while a reader folding the whole
    /// log went on deriving turn five, and the two would disagree about which
    /// message is which.
    async fn catch_up(
        &self,
        session: AgentSessionId,
    ) -> std::result::Result<FoldMachineImpl, rootcause::Report> {
        let log = AgentSessionLogRepo::list_by_session(&self.repo, session)
            .await
            .map_err(|error| rootcause::report!(error))?;

        let mut fold = FoldMachineImpl::new();
        for stored in log {
            let _ = fold.push(stored.entry);
        }
        Ok(fold)
    }
}

/// Step the actor until its machine stops, then release the registry entry.
async fn run_session<Connector, Logs>(
    mut actor: SessionActor<Connector, Logs>,
    active: std::sync::Weak<ActiveSessions>,
    commands: mpsc::Sender<SessionCommand>,
) where
    Connector: AgentConnector,
    Logs: AgentSessionLogWriter + AgentSessionRepo,
{
    while actor.step().await == Stepped::Continue {}

    // Refuse late commands before releasing the registry entry, so a caller
    // cannot enqueue into an actor that will never step again.
    actor.close();
    let id = actor.id();

    // Tear down the old transport before allowing another actor to attach.
    drop(actor);
    if let Some(active) = active.upgrade() {
        active.remove_if(&id, |_, current| current.same_channel(&commands));
    }
}
