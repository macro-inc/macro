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
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToServerMessage};
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, OwnerAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::{Mutex, mpsc, oneshot, watch};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::instrument::WithSubscriber as _;

use bots::domain::models::BotId;

use super::connection::RuntimeAttachment;
use super::error::{AgentSessionError, Result};
use super::model::{
    AgentSession, AgentSessionId, AgentSessionLog, AgentSessionRenamed, AuthorKind, ChannelSession,
    CreateAgentSessionParams, LogAppended, MAX_AGENT_SESSION_NAME_CHARS, Message, MessageId,
    SandboxSize, SessionLog, StoredAgentSessionLog,
};
use super::ports::{
    AgentConnector, AgentSessionLogRepo, AgentSessionLogWriter, AgentSessionNameGenerator,
    AgentSessionRealtime, AgentSessionRepo, NoOpAgentSessionNameGenerator,
};
use super::session::actors::{SessionActor, SessionCommand, Stepped};
use super::session::{CloseReason, Input};

/// Buffered not-yet-accepted commands per session actor.
const COMMAND_BUFFER: usize = 1028;
/// Persistence may delay lifecycle teardown, but never indefinitely.
const SESSION_PERSIST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
/// How long a command may sit queued behind the ACP handshake
/// (`Booting`/`Initializing`/`Opening`) before the caller gives up on it.
/// The runtime never completes a queued command on its own until it reaches
/// `Live` - see [`super::session::session::SessionMachine::on_command`] - so
/// without this bound a stalled handshake (e.g. the runtime process never
/// sends `AcpReady`, or never answers `initialize`/`session/new`) hangs the
/// caller forever.
#[cfg(not(test))]
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
#[cfg(test)]
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(50);

struct ActiveSession {
    commands: Option<mpsc::Sender<SessionCommand>>,
    stopped: watch::Receiver<bool>,
    marker: Arc<()>,
    deleting: bool,
    stopping: bool,
}

type ActiveSessions = DashMap<AgentSessionId, ActiveSession>;

struct AttachReservation {
    active: Arc<ActiveSessions>,
    id: AgentSessionId,
    marker: Arc<()>,
    stopped: Option<watch::Sender<bool>>,
    committed: bool,
}

impl AttachReservation {
    fn commit(mut self) -> (Arc<()>, watch::Sender<bool>) {
        self.committed = true;
        (
            self.marker.clone(),
            self.stopped.take().expect("reservation owns stop signal"),
        )
    }
}

impl Drop for AttachReservation {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        if let Some(stopped) = self.stopped.take() {
            let _ = stopped.send(true);
        }
        self.active.remove_if(&self.id, |_, active| {
            Arc::ptr_eq(&active.marker, &self.marker) && !active.stopping
        });
    }
}

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

    /// Rename a session after owner access has been verified.
    fn rename_session(
        &self,
        access: &EntityAccessReceipt<OwnerAccessLevel>,
        name: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Delete an agent session by id.
    fn delete_session(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// Release this session's live transport, if it has one.
    ///
    /// The actor observes its command channel closing and winds itself down
    /// through the ordinary close path, so this is enough to end a connection;
    /// it does not touch anything durable. A session with no active transport
    /// is already in the state this asks for, so it succeeds.
    fn close_session(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// Persist that a session disconnected before a live actor could report it.
    fn mark_disconnected(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

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

    /// Persist the sandbox size this session is running at.
    fn set_sandbox_size(
        &self,
        id: AgentSessionId,
        size: SandboxSize,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The user's default sandbox size for new `@coder` sessions.
    ///
    /// A missing preference is [`SandboxSize::Default`].
    fn user_sandbox_size(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<SandboxSize>> + Send;

    /// Upsert the user's default sandbox size for the next `@coder` mention.
    fn set_user_sandbox_size(
        &self,
        user_id: &MacroUserIdStr<'static>,
        size: SandboxSize,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Agent session service backed by one durable repository and local actors.
///
/// `R` is the persistence adapter implementing both [`AgentSessionRepo`] and
/// [`AgentSessionLogRepo`], e.g. `outbound::postgres::PgAgentSessionRepo`.
/// `Folds` answers "what messages does this session's log derive" -
/// `agent_fold` folding the log on read - and `Rt` streams each frame to
/// whoever is watching the session's channel right now.
#[derive(Clone)]
pub struct AgentSessionServiceImpl<R, Folds, Rt, Namer = NoOpAgentSessionNameGenerator> {
    repo: R,
    folds: Folds,
    realtime: Rt,
    name_generator: Namer,
    active: Arc<ActiveSessions>,
    tasks: TaskTracker,
    cancellation: CancellationToken,
    lifecycle: Arc<Mutex<()>>,
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
            name_generator: NoOpAgentSessionNameGenerator,
            active: Arc::new(DashMap::new()),
            tasks: TaskTracker::new(),
            cancellation: CancellationToken::new(),
            lifecycle: Arc::new(Mutex::new(())),
        }
    }
}

impl<R, Folds, Rt, Namer> AgentSessionServiceImpl<R, Folds, Rt, Namer> {
    /// Replace the no-op name generator with a production adapter.
    #[must_use]
    pub fn with_name_generator<NextNamer>(
        self,
        name_generator: NextNamer,
    ) -> AgentSessionServiceImpl<R, Folds, Rt, NextNamer> {
        AgentSessionServiceImpl {
            repo: self.repo,
            folds: self.folds,
            realtime: self.realtime,
            name_generator,
            active: self.active,
            tasks: self.tasks,
            cancellation: self.cancellation,
            lifecycle: self.lifecycle,
        }
    }

    /// Stop active actors and wait for their tasks to release their transports.
    pub async fn shutdown(&self) {
        let lifecycle = self.lifecycle.lock().await;
        self.cancellation.cancel();
        for mut session in self.active.iter_mut() {
            session.commands.take();
            session.stopping = true;
        }
        self.tasks.close();
        drop(lifecycle);
        self.tasks.wait().await;
        self.active.clear();
    }

    async fn reserve_attach(&self, id: AgentSessionId) -> Result<AttachReservation> {
        let _lifecycle = self.lifecycle.lock().await;
        if self.cancellation.is_cancelled() {
            return Err(AgentSessionError::Disconnected(id));
        }
        let (stopped_tx, stopped) = watch::channel(false);
        let marker = Arc::new(());
        match self.active.entry(id) {
            Entry::Occupied(_) => Err(AgentSessionError::AlreadyConnected(id)),
            Entry::Vacant(entry) => {
                entry.insert(ActiveSession {
                    commands: None,
                    stopped,
                    marker: marker.clone(),
                    deleting: false,
                    stopping: false,
                });
                Ok(AttachReservation {
                    active: self.active.clone(),
                    id,
                    marker,
                    stopped: Some(stopped_tx),
                    committed: false,
                })
            }
        }
    }

    async fn activate_reserved<Connector>(
        &self,
        session: AgentSession,
        attachment: RuntimeAttachment<Connector>,
        reservation: AttachReservation,
    ) -> Result<()>
    where
        R: AgentSessionRepo + AgentSessionLogRepo + Clone,
        Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
        Connector: AgentConnector,
    {
        let _lifecycle = self.lifecycle.lock().await;
        let id = session.id;
        if self.cancellation.is_cancelled() {
            return Err(AgentSessionError::Disconnected(id));
        }
        let (commands, command_rx) = mpsc::channel(COMMAND_BUFFER);
        let Some(mut active) = self.active.get_mut(&id) else {
            return Err(AgentSessionError::Disconnected(id));
        };
        if !Arc::ptr_eq(&active.marker, &reservation.marker) || active.stopping {
            return Err(AgentSessionError::Disconnected(id));
        }
        active.commands = Some(commands.clone());
        drop(active);
        let (marker, stopped_tx) = reservation.commit();

        // The actor owns this session's log writes, so it gets the live writer
        // rather than the bare repository - see module docs. Its fold starts
        // empty and catches itself up on the stored log on the first frame,
        // which costs an attach nothing until the session actually says
        // something.
        let logs = LiveSessionLogWriter::new(self.repo.clone(), self.realtime.clone());
        let actor = SessionActor::new(
            id,
            session.acp_session_id,
            session.workspace,
            attachment.mcp_servers,
            attachment.connector,
            logs,
            command_rx,
            attachment.handshake,
        );
        self.tasks.spawn(
            run_session(
                actor,
                Arc::downgrade(&self.active),
                marker,
                stopped_tx,
                self.cancellation.clone(),
            )
            .with_current_subscriber(),
        );
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
            .and_then(|entry| entry.commands.clone())
            .ok_or(AgentSessionError::Disconnected(id))?;

        let (completed, result) = oneshot::channel();
        let span = tracing::info_span!(
            "agent.session.command",
            agent.session.id = %id,
            agent.action.name = action.as_ref(),
            agent.command.queue_wait_ms = tracing::field::Empty,
            agent.session.runtime_phase_at_dequeue = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        if commands
            .send(SessionCommand {
                user_id,
                action,
                action_id,
                completed,
                span,
                enqueued_at: tokio::time::Instant::now(),
            })
            .await
            .is_err()
        {
            return Err(AgentSessionError::Disconnected(id));
        }
        // Not needed past this point, and holding it would be exactly the bug
        // `begin_stop` exists to avoid: a live sender clone keeping the
        // channel open no matter how many others get dropped, so the actor
        // can only notice by hitting its own much longer internal deadline
        // instead of promptly.
        drop(commands);
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, result).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(AgentSessionError::Disconnected(id)),
            Err(_elapsed) => {
                // The actor is presumably still stuck in the handshake, so it
                // is stopped directly - the same "drop the sender, the actor
                // notices and tears itself down" mechanism `close_session`
                // uses - rather than left to queue behind the same stall
                // forever.
                let (stopped, marker) = self.begin_stop(id, false);
                Self::wait_stopped(stopped).await;
                self.active.remove_if(&id, |_, active| {
                    Arc::ptr_eq(&active.marker, &marker) && !active.deleting
                });
                tracing::warn!(%id, "agent session command timed out waiting for the ACP handshake");
                Err(AgentSessionError::Disconnected(id))
            }
        }
    }

    fn begin_stop(&self, id: AgentSessionId, deleting: bool) -> (watch::Receiver<bool>, Arc<()>) {
        match self.active.entry(id) {
            Entry::Occupied(mut entry) => {
                let active = entry.get_mut();
                let attaching = active.commands.is_none() && !active.stopping;
                active.commands.take();
                active.deleting |= deleting;
                active.stopping = true;
                let stopped = if attaching {
                    let (_stopped_tx, stopped) = watch::channel(true);
                    stopped
                } else {
                    active.stopped.clone()
                };
                (stopped, active.marker.clone())
            }
            Entry::Vacant(entry) => {
                let (_stopped_tx, stopped) = watch::channel(true);
                let marker = Arc::new(());
                entry.insert(ActiveSession {
                    commands: None,
                    stopped: stopped.clone(),
                    marker: marker.clone(),
                    deleting,
                    stopping: true,
                });
                (stopped, marker)
            }
        }
    }

    async fn wait_stopped(mut stopped: watch::Receiver<bool>) {
        if !*stopped.borrow() {
            let _ = stopped.wait_for(|value| *value).await;
        }
    }
}

impl<R, Folds, Rt, Namer> AgentSessionService for AgentSessionServiceImpl<R, Folds, Rt, Namer>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
    Folds: FoldedMessageRepo + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
    Namer: AgentSessionNameGenerator + Clone,
{
    async fn create_session(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        AgentSessionRepo::create(&self.repo, params).await
    }

    async fn rename_session(
        &self,
        access: &EntityAccessReceipt<OwnerAccessLevel>,
        name: &str,
    ) -> Result<()> {
        let name = validate_agent_session_name(name)?;
        if access.entity().entity_type != EntityType::AgentSession {
            return Err(AgentSessionError::Unknown(anyhow::anyhow!(
                "agent session rename received access for another entity type"
            )));
        }
        let id =
            AgentSessionId::new_from_uuid(Uuid::parse_str(&access.entity().entity_id).map_err(
                |error| anyhow::anyhow!("invalid agent session access receipt: {error}"),
            )?);
        self.repo.set_name(id, name).await?;
        self.realtime
            .publish_renamed(AgentSessionRenamed {
                agent_session_id: id,
                name: name.to_owned(),
            })
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, %id, "failed to publish agent session rename");
            })
            .ok();
        Ok(())
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
        let (stopped, marker) = self.begin_stop(id, true);
        Self::wait_stopped(stopped).await;
        let result = self.repo.delete(id).await;
        self.active
            .remove_if(&id, |_, active| Arc::ptr_eq(&active.marker, &marker));
        result
    }

    async fn close_session(&self, id: AgentSessionId) -> Result<()> {
        // Dropping the sender is the whole operation: the actor's next step
        // reads `None` from its command channel, treats it as `Abandoned`, and
        // tears the transport down on its way out.
        let (stopped, marker) = self.begin_stop(id, false);
        Self::wait_stopped(stopped).await;
        self.active.remove_if(&id, |_, active| {
            Arc::ptr_eq(&active.marker, &marker) && !active.deleting
        });
        Ok(())
    }

    async fn mark_disconnected(&self, id: AgentSessionId) -> Result<()> {
        let mut logs = LiveSessionLogWriter::new(self.repo.clone(), self.realtime.clone());
        tokio::time::timeout(
            SESSION_PERSIST_TIMEOUT,
            logs.append(AgentSessionLog {
                agent_session_id: id,
                user_id: None,
                content: Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::Disconnected,
                }),
            }),
        )
        .await
        .unwrap_or(Err(AgentSessionError::LogTimedOut(id)))
    }

    async fn attach_session<Connector>(
        &self,
        id: AgentSessionId,
        attachment: RuntimeAttachment<Connector>,
    ) -> Result<()>
    where
        Connector: AgentConnector,
    {
        let reservation = self.reserve_attach(id).await?;
        let session = self.repo.get(id).await?;
        self.activate_reserved(session, attachment, reservation)
            .await
    }

    async fn send_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
        action_id: AgentActionId,
    ) -> Result<()> {
        let initial_prompt = initial_prompt_for_rename(&self.folds, id, &action).await;

        self.deliver_action(id, user_id, action, action_id).await?;
        if let Some(initial_prompt) = initial_prompt {
            spawn_initial_agent_session_rename(
                self.repo.clone(),
                self.realtime.clone(),
                self.name_generator.clone(),
                id,
                initial_prompt,
            );
        }
        Ok(())
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

    async fn set_sandbox_size(&self, id: AgentSessionId, size: SandboxSize) -> Result<()> {
        self.repo.set_sandbox_size(id, size).await
    }

    async fn user_sandbox_size(&self, user_id: &MacroUserIdStr<'static>) -> Result<SandboxSize> {
        self.repo.user_sandbox_size(user_id).await
    }

    async fn set_user_sandbox_size(
        &self,
        user_id: &MacroUserIdStr<'static>,
        size: SandboxSize,
    ) -> Result<()> {
        self.repo.set_user_sandbox_size(user_id, size).await
    }
}

async fn initial_prompt_for_rename<Folds>(
    folds: &Folds,
    id: AgentSessionId,
    action: &AgentAction,
) -> Option<String>
where
    Folds: FoldedMessageRepo,
{
    let AgentAction::Prompt(prompt) = action else {
        return None;
    };
    folds
        .next_turn_id(id)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                %id,
                "failed to determine whether agent prompt was the first"
            );
        })
        .ok()
        .filter(|turn| *turn == MessageId::first(AuthorKind::User).turn)
        .map(|_| prompt.name_source().to_owned())
}

fn spawn_initial_agent_session_rename<R, Rt, Namer>(
    repo: R,
    realtime: Rt,
    name_generator: Namer,
    id: AgentSessionId,
    initial_prompt: String,
) where
    R: AgentSessionRepo + Clone,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
    Namer: AgentSessionNameGenerator + Send + Sync + 'static,
{
    tokio::spawn(async move {
        let result: std::result::Result<(), rootcause::Report> = async {
            let session = repo
                .get(id)
                .await
                .map_err(|error| rootcause::report!(error))?;
            let Some(name) = name_generator
                .generate_name(&session, &initial_prompt)
                .await?
            else {
                return Ok(());
            };
            let renamed = repo
                .set_name_if_default(id, &name)
                .await
                .map_err(|error| rootcause::report!(error))?;
            if !renamed {
                return Ok(());
            }
            realtime
                .publish_renamed(AgentSessionRenamed {
                    agent_session_id: id,
                    name,
                })
                .await?;
            Ok(())
        }
        .await;

        if let Err(error) = result {
            tracing::warn!(error = ?error, %id, "failed to auto-rename initial agent session");
        }
    });
}

fn validate_agent_session_name(raw: &str) -> Result<&str> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AgentSessionError::InvalidName("name must not be blank"));
    }
    if name == crate::domain::model::DEFAULT_AGENT_SESSION_NAME {
        return Err(AgentSessionError::InvalidName(
            "name must be more specific than the default",
        ));
    }
    if name.chars().count() > MAX_AGENT_SESSION_NAME_CHARS {
        return Err(AgentSessionError::InvalidName(
            "name must be at most 100 characters",
        ));
    }
    Ok(name)
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

    async fn find_by_egress_token_hash(
        &self,
        egress_token_hash: &str,
    ) -> Result<Option<AgentSession>> {
        self.repo.find_by_egress_token_hash(egress_token_hash).await
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

    async fn find_all_for_thread(&self, thread_id: Uuid) -> Result<Vec<AgentSession>> {
        self.repo.find_all_for_thread(thread_id).await
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

    async fn set_name(&self, id: AgentSessionId, name: &str) -> Result<()> {
        self.repo.set_name(id, name).await
    }

    async fn set_name_if_default(&self, id: AgentSessionId, name: &str) -> Result<bool> {
        self.repo.set_name_if_default(id, name).await
    }

    async fn set_sandbox_size(&self, id: AgentSessionId, size: SandboxSize) -> Result<()> {
        self.repo.set_sandbox_size(id, size).await
    }

    async fn user_sandbox_size(&self, user_id: &MacroUserIdStr<'static>) -> Result<SandboxSize> {
        self.repo.user_sandbox_size(user_id).await
    }

    async fn set_user_sandbox_size(
        &self,
        user_id: &MacroUserIdStr<'static>,
        size: SandboxSize,
    ) -> Result<()> {
        self.repo.set_user_sandbox_size(user_id, size).await
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
    #[tracing::instrument(
        name = "agent.session.realtime.publish",
        err,
        skip(self, agent_session_id, entry),
        fields(agent.session.id = %agent_session_id)
    )]
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
    marker: Arc<()>,
    stopped: watch::Sender<bool>,
    cancellation: CancellationToken,
) where
    Connector: AgentConnector,
    Logs: AgentSessionLogWriter + AgentSessionRepo,
{
    loop {
        let input = tokio::select! {
            biased;
            () = cancellation.cancelled() => Input::Closed(CloseReason::Abandoned),
            input = actor.next_input() => input,
        };
        let stepped = actor.dispatch(input).await;
        if stepped == Stepped::Stopped {
            break;
        }
    }

    // Refuse late commands before releasing the registry entry, so a caller
    // cannot enqueue into an actor that will never step again.
    actor.close();
    let id = actor.id();

    // Tear down the old transport before allowing another actor to attach.
    drop(actor);
    let _ = stopped.send(true);
    if let Some(active) = active.upgrade() {
        active.remove_if(&id, |_, current| {
            current.commands.is_some() && Arc::ptr_eq(&current.marker, &marker)
        });
    }
}
