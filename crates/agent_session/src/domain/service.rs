//! Persistence and active lifecycle management for agent sessions.
//!
//! Inbound adapters depend on [`AgentSessionService`] rather than repository
//! ports. Protocol decisions live in [`super::session`]'s pure machine, and
//! each connection's effects are executed by its actor shell.
//!
//! Appending to a session's log is what keeps its channel in step with it:
//! every folded message the log derives gets a placeholder comms message, and
//! the append is what notices it is missing.
//!
//! A live session's log is written by its actor rather than through
//! [`AgentSessionService::append_event`], so the actor is handed a
//! [`PlaceholderSyncingLogs`] instead of the bare repository. That is what
//! makes the two paths agree: the actor keeps writing frames the only way it
//! knows how, and placeholders appear either way.
//!
//! The two paths get there differently, because they know different amounts.
//! Anyone writing a run of frames in order has somewhere to keep state, so
//! [`PlaceholderSyncingLogs`] holds an `agent_fold` machine and pushes each
//! frame into it - the streamed chunks that make up most of a log cost one
//! push and no I/O. That is a session's actor, and equally `seed_jsonl`
//! replaying a recording.
//!
//! [`PlaceholderSyncingLogs`] is also where a live session's folded messages
//! are streamed from, for the same reason: it is the one place every frame of
//! a connected session passes through, and its fold is what knows which
//! message a frame changed. Viewers are sent the changed message itself, not
//! the frame - folding is the server's job, and most frames change nothing a
//! reader can see. Neither the placeholder write nor the push can fail the
//! durable append - see [`AgentSessionRealtime`].
//!
//! A lone frame has no run to amortize over, so
//! [`AgentSessionService::append_event`] - and the
//! [`AgentSessionService::sync_placeholders`] repair path, which additionally
//! has to notice placeholders that were deleted or never written - ask
//! [`FoldedMessageRepo`] what the whole log derives and diff that against
//! comms. Both arrive at the same placeholders because both read the same
//! fold.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionId;
use agent_fold::domain::fold::FoldMachineImpl;
use agent_fold::domain::model::IncrementalFoldResult;
use agent_fold::domain::ports::{FoldMachine, FoldedMessageRepo};
use agent_runtime_protocol::domain::action::AgentAction;
use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::{Mutex, mpsc, oneshot};

use super::error::{AgentSessionError, Result};
use super::model::{
    AgentSession, AgentSessionId, AgentSessionLog, Author, ChannelFoldedMessages, ChannelSession,
    CreateAgentSessionParams, FoldedMessage, FoldedMessageChange, FoldedMessagePublished,
    MessageId,
};
use super::ports::{
    AgentConnector, AgentSessionLogRepo, AgentSessionRealtime, AgentSessionRepo, Comms,
};
use super::session::actors::{SessionActor, SessionCommand, Stepped};

/// Buffered not-yet-accepted commands per session actor.
const COMMAND_BUFFER: usize = 1028;

type ActiveSessions = DashMap<AgentSessionId, mpsc::Sender<SessionCommand>>;

/// Durable and live use cases for agent sessions.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionService: Send + Sync + 'static {
    /// Persist a session and attach its already-provisioned transport.
    fn create_session<Connector>(
        &self,
        params: CreateAgentSessionParams,
        connector: Connector,
    ) -> impl Future<Output = Result<AgentSession>> + Send
    where
        Connector: AgentConnector + Clone;

    /// Get a persisted agent session by id.
    fn get_session(&self, id: AgentSessionId) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Replace an existing agent session.
    fn update_session(&self, session: AgentSession) -> impl Future<Output = Result<()>> + Send;

    /// Delete an agent session by id.
    fn delete_session(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// Attach a new transport to an existing persisted session.
    fn attach_session<Connector>(
        &self,
        id: AgentSessionId,
        connector: Connector,
    ) -> impl Future<Output = Result<()>> + Send
    where
        Connector: AgentConnector + Clone;

    /// Deliver an action through the session's active transport.
    fn send_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Append a protocol event to a session's log, creating a placeholder
    /// comms message for every folded message the log now derives that does
    /// not have one yet.
    ///
    /// This is the path for a session with no live actor - seeding a log from
    /// a recording, or replaying one. A connected session's frames reach the
    /// same place through its actor; see the module docs.
    fn append_event(&self, log: AgentSessionLog) -> impl Future<Output = Result<()>> + Send;

    /// Bring a session's channel back in step with its log without appending
    /// anything, creating whatever placeholders are missing.
    ///
    /// Placeholders are derived, never authoritative, so they can be dropped
    /// and rebuilt from the log at any time - which is what this is for.
    fn sync_placeholders(&self, session: AgentSessionId)
    -> impl Future<Output = Result<()>> + Send;

    /// The folded messages of the agent session behind a channel, or `None`
    /// when no session owns the channel.
    ///
    /// The one fold a reader ever sees: the log is read once, folded here,
    /// and served with the frame count it was folded from so a reader can
    /// align the snapshot with the live stream. See [`ChannelFoldedMessages`].
    fn channel_messages(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Option<ChannelFoldedMessages>>> + Send;
}

/// Agent session service backed by one durable repository and local actors.
///
/// `R` is the persistence adapter implementing both [`AgentSessionRepo`] and
/// [`AgentSessionLogRepo`], e.g. `outbound::postgres::PgAgentSessionRepo`.
/// `Folds` answers "what messages does this session's log derive" -
/// `agent_fold` folding the log on read - `C` writes placeholder messages
/// into the session's channel, and `Rt` streams each frame to whoever is
/// watching that channel right now.
pub struct AgentSessionServiceImpl<R, Folds, C, Rt> {
    repo: R,
    folds: Folds,
    comms: C,
    realtime: Rt,
    active: Arc<ActiveSessions>,
}

impl<R, Folds, C, Rt> AgentSessionServiceImpl<R, Folds, C, Rt> {
    /// Build a service from its persistence port, fold, comms writer, and
    /// realtime publisher.
    ///
    /// Only a live session streams, so a caller with no viewers to serve -
    /// tests, and the offline placeholder repair - passes
    /// [`NoOpRealtime`](super::ports::NoOpRealtime).
    pub fn new(repo: R, folds: Folds, comms: C, realtime: Rt) -> Self {
        Self {
            repo,
            folds,
            comms,
            realtime,
            active: Arc::new(DashMap::new()),
        }
    }

    fn register_transport<Connector>(
        &self,
        id: AgentSessionId,
        acp_session_id: Option<SessionId>,
        connector: Connector,
    ) -> Result<()>
    where
        R: AgentSessionRepo + AgentSessionLogRepo + Clone,
        C: Comms + Clone + Send + Sync + 'static,
        Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
        Connector: AgentConnector + Clone,
    {
        let (commands, command_rx) = mpsc::channel(COMMAND_BUFFER);

        match self.active.entry(id) {
            Entry::Occupied(_) => return Err(AgentSessionError::AlreadyConnected(id)),
            Entry::Vacant(entry) => {
                entry.insert(commands.clone());
            }
        }

        // The actor owns this session's log writes, so it writes through the
        // placeholder sync rather than the bare repository - see module docs.
        // Its fold starts empty and catches itself up on the stored log on the
        // first frame, which keeps this sync and costs an attach nothing until
        // the session actually says something.
        let logs = PlaceholderSyncingLogs::new(
            self.repo.clone(),
            self.comms.clone(),
            self.realtime.clone(),
        );
        let actor = SessionActor::new(id, acp_session_id, connector, logs, command_rx);
        tokio::spawn(run_session(actor, Arc::downgrade(&self.active), commands));
        Ok(())
    }

    async fn deliver_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
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

    /// The session a channel renders, or `None` when no session owns it.
    ///
    /// A channel load carries no thread or bot context, so only the
    /// dedicated-channel relation can match; thread-scoped sessions are
    /// rendered by their own dedicated channels.
    async fn session_for_channel(&self, channel_id: Uuid) -> Result<Option<AgentSession>>
    where
        R: AgentSessionRepo,
    {
        Ok(
            match self.repo.find_for_channel(channel_id, None, None).await? {
                ChannelSession::None => None,
                ChannelSession::InDedicatedChannel(session)
                | ChannelSession::CreatedFromThread(session) => Some(session),
                ChannelSession::ThreadInDedicatedChannel {
                    dedicated_channel_agent_session,
                    ..
                } => Some(dedicated_channel_agent_session),
            },
        )
    }
}

impl<R, Folds, C, Rt> AgentSessionService for AgentSessionServiceImpl<R, Folds, C, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
    Folds: FoldedMessageRepo + Clone + Send + Sync + 'static,
    C: Comms + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
{
    async fn create_session<Connector>(
        &self,
        params: CreateAgentSessionParams,
        connector: Connector,
    ) -> Result<AgentSession>
    where
        Connector: AgentConnector + Clone,
    {
        let session = AgentSessionRepo::create(&self.repo, params).await?;
        self.register_transport(session.id, None, connector)?;
        Ok(session)
    }

    async fn get_session(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.repo.get(id).await
    }

    async fn update_session(&self, session: AgentSession) -> Result<()> {
        self.repo.update(session).await
    }

    async fn delete_session(&self, id: AgentSessionId) -> Result<()> {
        self.repo.delete(id).await
    }

    async fn attach_session<Connector>(
        &self,
        id: AgentSessionId,
        connector: Connector,
    ) -> Result<()>
    where
        Connector: AgentConnector + Clone,
    {
        let session = self.repo.get(id).await?;
        self.register_transport(
            session.id,
            session.acp_session_id.map(Into::into),
            connector,
        )
    }

    async fn send_action(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<()> {
        self.deliver_action(id, user_id, action).await
    }

    #[tracing::instrument(err, skip(self, log))]
    async fn append_event(&self, log: AgentSessionLog) -> Result<()> {
        let session_id = log.agent_session_id;
        AgentSessionLogRepo::create(&self.repo, log).await?;
        self.sync_placeholders(session_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn sync_placeholders(&self, session_id: AgentSessionId) -> Result<()> {
        create_missing_placeholders(&self.repo, &self.folds, &self.comms, session_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn channel_messages(&self, channel_id: Uuid) -> Result<Option<ChannelFoldedMessages>> {
        let Some(session) = self.session_for_channel(channel_id).await? else {
            return Ok(None);
        };

        // Folded from one log read rather than through the `Folds` port, so
        // the frame count and the messages describe the same instant - the
        // pair is what lets a reader align this snapshot with the stream.
        let entries = AgentSessionLogRepo::list_by_session(&self.repo, session.id).await?;
        let log_length = entries.len() as u64;
        Ok(Some(ChannelFoldedMessages {
            agent_session_id: session.id,
            bot: self.repo.session_bot(session.bot_id).await?,
            log_length,
            messages: agent_fold::domain::fold::fold(entries),
        }))
    }
}

/// The [`AgentSessionLogRepo`] a session's actor writes through: the durable
/// append, then the placeholder sync that keeps the session's channel in step
/// with what its log now derives.
///
/// A connected session's frames never pass through
/// [`AgentSessionService::append_event`] - the actor owns the log write - so
/// without this the log would fill up while the channel stayed empty.
///
/// This is also where a writer's fold lives. One session is hundreds of
/// frames, and asking what the whole log derives on each of them made the
/// work quadratic in the length of the session while answering "nothing new"
/// almost every time. Instead the fold is [`PlaceholderState`], carried from
/// frame to frame, and each frame is pushed into it.
///
/// Public because a session's actor is not the only thing that writes a run of
/// frames in order: `seed_jsonl` replays a whole recording, and wants the same
/// arithmetic rather than a refold per line. Anything writing one frame at a
/// time should write through this; [`AgentSessionService::append_event`] is
/// for a lone frame with no run to amortize over.
pub struct PlaceholderSyncingLogs<R, C, Rt> {
    repo: R,
    comms: C,
    realtime: Rt,
    /// The writer's fold and what it has left to place.
    ///
    /// One writer goes through this, in order, so the lock is never
    /// contended. It is here because [`AgentSessionLogRepo::create`] takes
    /// `&self`, and holding it across the whole sync is what keeps a frame's
    /// fold and its placeholder writes from interleaving with the next
    /// frame's.
    state: Mutex<PlaceholderState>,
}

impl<R, C, Rt> PlaceholderSyncingLogs<R, C, Rt> {
    /// A log writer that keeps `session`'s channel in step as it writes, and
    /// streams each folded message a frame changes to whoever is watching
    /// that channel.
    ///
    /// The fold starts empty and catches itself up on whatever is already
    /// stored when the first frame arrives, so this is cheap to build and
    /// correct against a session that already has a log.
    pub fn new(repo: R, comms: C, realtime: Rt) -> Self {
        Self {
            repo,
            comms,
            realtime,
            state: Mutex::new(PlaceholderState::default()),
        }
    }
}

/// What one writer remembers between frames.
#[derive(Default)]
struct PlaceholderState {
    /// The writer's incremental fold.
    ///
    /// `None` until the first frame catches it up on the session's stored
    /// log. See [`PlaceholderSyncingLogs::catch_up`].
    fold: Option<FoldMachineImpl>,
    /// How many log frames the fold has consumed, the stored log it caught
    /// itself up on included.
    ///
    /// Stamped onto every published message as
    /// [`FoldedMessagePublished::log_index`], and comparable with the
    /// `log_length` a snapshot reports because both count the same thing:
    /// this writer is the only thing appending to the session's log, so its
    /// count and the stored row count cannot drift.
    frames: u64,
    /// Messages the fold has derived that comms has not accepted yet.
    ///
    /// The fold announces a message exactly once, so a placeholder write that
    /// fails cannot simply be dropped - nothing would ever mention that
    /// message again. Holding it here means the next frame retries it, which
    /// is what refolding the whole session every time used to give for free.
    unplaced: Vec<(MessageId, Author)>,
    /// The channel this writer's session renders into.
    ///
    /// A frame carries only its session, but streaming addresses a channel,
    /// so without remembering it every frame would cost a session read - and
    /// most frames are stream chunks that otherwise touch nothing but the log
    /// insert. Kept here rather than taken in the constructor because a
    /// writer is built when a transport attaches, before anything has looked
    /// the session up; the first frame that needs it pays for the lookup and
    /// every frame after it is free. A writer serves one session for its
    /// lifetime, and a session never changes channel, so this cannot go
    /// stale.
    channel_id: Option<Uuid>,
}

impl<R, C, Rt> AgentSessionLogRepo for PlaceholderSyncingLogs<R, C, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
    C: Comms + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    async fn create(&self, log: AgentSessionLog) -> Result<()> {
        let session = log.agent_session_id;

        // Durable first, then the projection: a placeholder naming a frame
        // that was not stored would point at a message no reload can derive.
        // That ordering is what costs the clone, and it is a fraction of the
        // refold it replaces.
        AgentSessionLogRepo::create(&self.repo, log.clone()).await?;

        // A failed sync must not fail the append. The actor treats a log
        // error as fatal to the connection, and placeholders are derived and
        // rebuildable (`sync_placeholders`) - killing a live session over a
        // projection it can recreate would be the wrong trade. A failure here
        // also costs this frame its stream - the change is what `place`
        // folds - which is the same class of loss: a viewer redraws on the
        // next frame, or reloads.
        let change = match self.place(session, log).await {
            Ok(change) => change,
            Err(error) => {
                tracing::error!(
                    error = ?error,
                    %session,
                    "failed to sync agent session placeholders"
                );
                None
            }
        };

        // Streamed after the placeholders, so a viewer never learns of a
        // message whose row is not in the channel yet.
        //
        // Best-effort for a weaker reason: the port drops messages by
        // contract, and the log this was folded from is already durable, so
        // the worst a failure costs is a viewer who has to reload.
        if let Some(change) = change
            && let Err(error) = self.stream(session, change).await
        {
            tracing::error!(
                error = ?error,
                %session,
                "failed to stream folded agent session message"
            );
        }
        Ok(())
    }

    async fn list_by_session(&self, session: AgentSessionId) -> Result<Vec<AgentSessionLog>> {
        AgentSessionLogRepo::list_by_session(&self.repo, session).await
    }
}

/// Pure delegation to the wrapped repository: the actor's shutdown path reads
/// and updates the session through its `Logs` handle, and those operations
/// have no placeholder side to sync.
impl<R, C, Rt> AgentSessionRepo for PlaceholderSyncingLogs<R, C, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo,
    C: Comms + Send + Sync + 'static,
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
        channel_id: Uuid,
        thread_id: Option<Uuid>,
        bot_id: Option<bots::domain::models::BotId>,
    ) -> Result<ChannelSession> {
        self.repo
            .find_for_channel(channel_id, thread_id, bot_id)
            .await
    }

    async fn update(&self, session: AgentSession) -> Result<()> {
        self.repo.update(session).await
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        self.repo.set_acp_session_id(id, acp_session_id).await
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        self.repo.delete(id).await
    }
}

impl<R, C, Rt> PlaceholderSyncingLogs<R, C, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo,
    C: Comms,
    Rt: AgentSessionRealtime,
{
    /// Push the message the frame just appended changed out to the session's
    /// channel.
    async fn stream(
        &self,
        agent_session_id: AgentSessionId,
        change: FoldedChange,
    ) -> std::result::Result<(), rootcause::Report> {
        let channel_id = self.channel_id(agent_session_id).await?;
        self.realtime
            .publish(FoldedMessagePublished {
                channel_id,
                agent_session_id,
                change: change.change,
                log_index: change.log_index,
                message: change.message,
            })
            .await
    }

    /// The channel `session_id` renders into, read once per writer and
    /// remembered - see [`PlaceholderState::channel_id`].
    async fn channel_id(
        &self,
        session_id: AgentSessionId,
    ) -> std::result::Result<Uuid, rootcause::Report> {
        let mut state = self.state.lock().await;
        if let Some(channel_id) = state.channel_id {
            return Ok(channel_id);
        }
        let session = self
            .repo
            .get(session_id)
            .await
            .map_err(|error| rootcause::report!(error))?;
        state.channel_id = Some(session.channel_id);
        Ok(session.channel_id)
    }

    /// Fold the frame just appended and place whatever it newly derived,
    /// along with anything an earlier frame left unplaced.
    ///
    /// Answers with the message the frame changed - what the caller streams
    /// once the placeholders are in - or `None` for the frames that change
    /// nothing renderable, which is most of them.
    async fn place(
        &self,
        session_id: AgentSessionId,
        entry: AgentSessionLog,
    ) -> std::result::Result<Option<FoldedChange>, rootcause::Report> {
        let mut guard = self.state.lock().await;
        // Reborrow once, so the fold and the unplaced list can be held as the
        // separate fields they are rather than through the guard.
        let state = &mut *guard;

        let change = if let Some(fold) = &mut state.fold {
            state.frames += 1;
            let change = FoldedChange::of(fold.push(entry), state.frames);
            if let Some(FoldedChange {
                change: FoldedMessageChange::New,
                message,
                ..
            }) = &change
            {
                state.unplaced.push((message.id(), message.author.clone()));
            }
            change
        } else {
            let caught_up = self.catch_up(session_id).await?;
            state.fold = Some(caught_up.fold);
            state.frames = caught_up.frames;
            state.unplaced.extend(caught_up.derived);
            caught_up.last_change
        };

        if state.unplaced.is_empty() {
            return Ok(change);
        }

        let session = self
            .repo
            .get(session_id)
            .await
            .map_err(|error| rootcause::report!(error))?;
        // Streaming wants the same thing this just read, so hand it over
        // rather than let it go and read it again.
        state.channel_id = Some(session.channel_id);

        // Nothing here asks comms what it already holds. Catching up
        // re-derives every message of an inherited log, so a re-attach does
        // re-offer placeholders that exist - and
        // [`Comms::create_message_placeholder`] is required to ignore those.
        // One redundant write per message, once per connection, is cheaper
        // than a query per connection to avoid it.

        // Whatever comms refuses stays unplaced for the next frame to retry,
        // so one failed write does not silently lose a message.
        let mut refused = Vec::new();
        let mut failure = None;
        for (id, author) in std::mem::take(&mut state.unplaced) {
            if let Err(error) = self
                .comms
                .create_message_placeholder(&session, id, &author)
                .await
            {
                refused.push((id, author));
                failure = Some(error);
            }
        }
        state.unplaced = refused;

        failure.map_or(Ok(change), Err)
    }

    /// Walk this connection's fold through the session's stored log, so it
    /// starts from where the session actually is rather than from nothing.
    ///
    /// Runs once per connection, on its first frame - by which point that
    /// frame is already in the log, so replaying the log folds it too and the
    /// caller must not push it again. The change to stream for that frame is
    /// the replay's final one ([`CaughtUp::last_change`]); everything the
    /// earlier frames changed was streamed as it happened, or is served by
    /// the snapshot a late reader fetches.
    ///
    /// This is what makes re-attaching correct, and it is about turn
    /// numbering rather than duplicate writes. [`TurnId`](agent_fold::domain::model::TurnId)s
    /// are a counter over the log, so a fold starting empty would hand
    /// `TurnId(0)` to the next prompt of a session already five turns in. That
    /// message would key to a placeholder another turn already owns, be
    /// dropped as a duplicate, and render nowhere - while a channel load,
    /// folding the whole log, went on deriving turn five.
    async fn catch_up(
        &self,
        session: AgentSessionId,
    ) -> std::result::Result<CaughtUp, rootcause::Report> {
        let log = AgentSessionLogRepo::list_by_session(&self.repo, session)
            .await
            .map_err(|error| rootcause::report!(error))?;

        let mut fold = FoldMachineImpl::new();
        let mut derived = Vec::new();
        let mut frames = 0;
        let mut last_change = None;
        for stored in log {
            frames += 1;
            // Only the final frame's change leaves this loop, so remember it
            // by key rather than cloning a whole message per frame - a
            // resumed session replays thousands.
            last_change = match fold.push(stored) {
                IncrementalFoldResult::NewMessage(message) => {
                    derived.push((message.id(), message.author.clone()));
                    Some((FoldedMessageChange::New, message.id()))
                }
                IncrementalFoldResult::MessageUpdate(message) => {
                    Some((FoldedMessageChange::Updated, message.id()))
                }
                IncrementalFoldResult::Unchanged => None,
            };
        }

        let last_change = last_change.and_then(|(change, id)| {
            let message = fold
                .messages()
                .iter()
                .find(|message| message.id() == id)?
                .clone();
            Some(FoldedChange {
                change,
                log_index: frames,
                message,
            })
        });

        Ok(CaughtUp {
            fold,
            derived,
            frames,
            last_change,
        })
    }
}

/// What [`PlaceholderSyncingLogs::catch_up`] hands back: the caught-up fold,
/// the messages it derived (all of them - a re-attach re-offers every
/// placeholder), how many frames it consumed, and the change the final frame
/// - the one whose append triggered the catch-up - made.
struct CaughtUp {
    fold: FoldMachineImpl,
    derived: Vec<(MessageId, Author)>,
    frames: u64,
    last_change: Option<FoldedChange>,
}

/// One frame's renderable effect, as [`PlaceholderSyncingLogs::place`] reports
/// it for streaming: [`FoldedMessagePublished`] minus the channel address,
/// which `stream` adds.
struct FoldedChange {
    change: FoldedMessageChange,
    log_index: u64,
    message: FoldedMessage,
}

impl FoldedChange {
    /// The change a push reported, the message cloned out of the machine.
    fn of(result: IncrementalFoldResult<'_>, log_index: u64) -> Option<Self> {
        let (change, message) = match result {
            IncrementalFoldResult::NewMessage(message) => (FoldedMessageChange::New, message),
            IncrementalFoldResult::MessageUpdate(message) => {
                (FoldedMessageChange::Updated, message)
            }
            IncrementalFoldResult::Unchanged => return None,
        };
        Some(Self {
            change,
            log_index,
            message: message.clone(),
        })
    }
}

/// Write a placeholder comms message for every folded message `session`'s log
/// derives that comms has not seen yet.
///
/// The path for callers with nowhere to keep a fold between frames: seeding a
/// log from a recording, and the repair that rebuilds a channel's placeholders
/// from scratch. A live connection does not come through here - it carries its
/// own fold, in [`PlaceholderSyncingLogs`].
///
/// Refolding the whole session is the point rather than a shortcoming: this is
/// also the path that has to notice placeholders that were never written, or
/// were deleted, which a fold that only reports what changed cannot see.
async fn create_missing_placeholders<R, Folds, C>(
    repo: &R,
    folds: &Folds,
    comms: &C,
    session: AgentSessionId,
) -> Result<()>
where
    R: AgentSessionRepo,
    Folds: FoldedMessageRepo,
    C: Comms,
{
    // Refold the whole session - fine for now - and create placeholders for
    // whatever messages comms has not seen yet. The fold is the source of
    // truth; comms only mirrors it.
    let messages = folds.messages(session).await?;
    if messages.is_empty() {
        return Ok(());
    }

    let session = repo.get(session).await?;
    let existing = comms.messages_with_placeholders(&session).await?;
    for message in messages {
        let id = message.id();
        if existing.contains(&id) {
            continue;
        }
        comms
            .create_message_placeholder(&session, id, &message.author)
            .await?;
    }

    Ok(())
}

/// Step the actor until its machine stops, then release the registry entry.
async fn run_session<Connector, Logs>(
    mut actor: SessionActor<Connector, Logs>,
    active: std::sync::Weak<ActiveSessions>,
    commands: mpsc::Sender<SessionCommand>,
) where
    Connector: AgentConnector + Clone,
    Logs: AgentSessionLogRepo + AgentSessionRepo,
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
