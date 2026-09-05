use super::error::Result;
use super::model::*;
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::ports::Transport;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

/// A bidirectional connection to an agent runtime.
pub trait AgentConnector:
    Transport<ToRuntimeMessage, ToServerMessage> + Send + Sync + 'static
{
}

impl<T> AgentConnector for T where
    T: Transport<ToRuntimeMessage, ToServerMessage> + Send + Sync + 'static
{
}

/// The facts about a bot that gate opening sessions for it.
#[derive(Debug, Clone)]
pub struct BotFacts {
    /// Whether mentioning the bot runs a coding agent.
    pub has_agent: bool,
    /// Whether this deployment provisions the bot's runtime itself. Managed
    /// bots' sessions are opened by the trigger pipeline, never over HTTP,
    /// and nothing may dial in for them.
    pub is_managed: bool,
    /// The user who owns the bot, when it is user-owned.
    pub owner_user_id: Option<MacroUserIdStr<'static>>,
    /// The registered harness this bot's agent is bound to, when it is one.
    pub harness_id: Option<harness_id::HarnessId>,
}

/// Read-only lookup of the bots sessions may be opened for.
pub trait BotDirectory: Send + Sync + 'static {
    /// Fetch a bot's facts; `None` when no such bot exists.
    fn bot_facts(&self, bot: BotId) -> impl Future<Output = Result<Option<BotFacts>>> + Send;
}

/// The mention that triggered a session, when one did.
///
/// Routes follow-up mentions in the thread to this session and feeds the
/// announcement - the magic-chip message the session's bot posts back into
/// the thread. The mention's text is quoted there for display only; the
/// runtime still delivers it as the first prompt through the session
/// control endpoint. Because all of this is claimed by the caller rather
/// than observed by the trigger pipeline, it never grants the thread's
/// channel any access to the session, and the announcement stands only
/// where the bot can already post.
#[derive(Debug, Clone)]
pub struct SessionThread {
    /// Channel the mentioning message was posted in.
    pub channel_id: Uuid,
    /// Thread the session belongs to.
    pub thread_id: Uuid,
    /// The mentioning message itself.
    pub message_id: Uuid,
    /// The mention's text, quoted in the announcement.
    pub content: String,
}

/// Everything needed to open a session served by an external runtime.
#[derive(Debug, Clone)]
pub struct OpenExternalAgentSession {
    /// The bot the session runs for.
    pub bot_id: BotId,
    /// Absolute directory the bot's harness runs in on its runtime.
    pub workspace: String,
    /// Repository nominally checked out at `workspace`, when stated.
    pub repo_url: Option<String>,
    /// The user who owns the session.
    pub owner: MacroUserIdStr<'static>,
    /// The thread whose mention triggered the session, when one did.
    pub thread: Option<SessionThread>,
    /// Instructions the session's runtime works under, when any were stated.
    pub instructions: Option<String>,
}

/// Everything needed to open a session the server hosts itself.
///
/// Deliberately thin: a managed session runs in a sandbox this deployment
/// provisions from its own configuration, so the bot, the repository and the
/// workspace are not the caller's to choose. There is no originating mention
/// and nothing to announce.
#[derive(Debug, Clone)]
pub struct OpenManagedSession {
    /// The user who owns the session and is credited for its messages.
    pub owner: MacroUserIdStr<'static>,
    /// First prompt to deliver once the sandbox is attached. `None` opens an
    /// idle session its owner prompts from the session's own surface.
    pub prompt: Option<String>,
    /// Instructions the session's runtime works under, for its whole life.
    /// `None` runs the runtime's own default.
    pub instructions: Option<String>,
}

/// Opens sessions, however they are served. Implemented by the harness, which
/// owns the session-opening semantics.
///
/// Two openings, because the two runtimes differ in who owns the machine: an
/// external session's runtime is hosted by the bot's operator and dials in on
/// its own schedule, while a managed session's sandbox is provisioned here.
/// That difference is why only one of them takes a workspace.
pub trait SessionOpener: Send + Sync + 'static {
    /// Open a session and return the persisted row.
    fn open_external_session(
        &self,
        request: OpenExternalAgentSession,
    ) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Provision a sandbox, open a session on it and return the persisted
    /// row, delivering `prompt` once it is attached.
    fn open_managed_session(
        &self,
        request: OpenManagedSession,
    ) -> impl Future<Output = Result<AgentSession>> + Send;

    /// The session a thread's mentions already route to, if one exists.
    /// What a caller whose open conflicted needs to recover: redeliveries
    /// resume serving the existing session instead of being dropped.
    fn find_thread_session(
        &self,
        thread_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Option<AgentSessionId>>> + Send;
}

/// `Send + Sync + 'static` with `Send` futures because callers drive sessions
/// from spawned tasks - a Kafka consumer hands each message to its own task,
/// and a repo whose futures are not `Send` cannot be used there.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionRepo: Send + Sync + 'static {
    /// Persist a new agent session, together with its access grants.
    ///
    /// Part of the contract, not an implementation detail: the owner is
    /// granted owner access, and - when the session was opened by a mention -
    /// the channel that mention was posted in is granted editor access,
    /// resolved from `originating_message_id` rather than trusted from the
    /// caller. The session and its grants land atomically, so a session
    /// cannot exist that nobody, not even its owner, could open.
    fn create(
        &self,
        params: CreateAgentSessionParams,
    ) -> impl Future<Output = Result<AgentSession>> + Send;

    /// Get an agent session by id.
    fn get(&self, id: AgentSessionId) -> impl Future<Output = Result<AgentSession>> + Send;

    /// The session a sandbox's egress token stands for, if any still does.
    ///
    /// `egress_token_hash` is the SHA-256 hex of the token as presented, never
    /// the token: implementations match on the stored hash, so the comparison
    /// happens in an index rather than over secret-derived bytes in memory.
    ///
    /// `None` rather than an error when nothing matches - a token we never
    /// minted and a token whose session has since been deleted are the same
    /// fact, and the caller refuses both the same way. The whole session comes
    /// back because everything the token entitles its holder to is on the row:
    /// the owner whose credentials it spends, the repository its git traffic is
    /// pinned to, and whether the session is still open.
    fn find_by_egress_token_hash(
        &self,
        egress_token_hash: &str,
    ) -> impl Future<Output = Result<Option<AgentSession>>> + Send;

    /// Find the session associated with an incoming channel context.
    ///
    /// Matches only when `thread_id` and `bot_id` are both given and a session
    /// was created from that thread by that bot -> `CreatedFromThread`;
    /// otherwise `None`. There is nothing else to match: a session does not
    /// own a channel, and messages sent directly to a session arrive through
    /// their own topic rather than as channel events.
    fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> impl Future<Output = Result<ChannelSession>> + Send;

    /// Every session rooted at this thread, newest first, regardless of bot.
    ///
    /// [`find_for_channel`](Self::find_for_channel) answers for one known bot;
    /// this answers when no bot was named - a message in the thread may still
    /// be meant for whichever agent lives there.
    fn find_all_for_thread(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Vec<AgentSession>>> + Send;

    /// The agent behind a session, for rendering the messages it sent.
    ///
    /// A bot that has been deleted still has messages in the channel, so this
    /// answers for one rather than failing - a session's history should not
    /// stop rendering because its agent was removed.
    fn session_bot(&self, id: BotId) -> impl Future<Output = Result<SessionBot>> + Send;

    /// Persist the agent-assigned ACP session id without replacing other session fields.
    fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Persist the model the session is running on. Idempotent.
    fn set_model(&self, id: AgentSessionId, model: &str)
    -> impl Future<Output = Result<()>> + Send;

    /// Persist the user-facing session name. Idempotent.
    fn set_name(&self, id: AgentSessionId, name: &str) -> impl Future<Output = Result<()>> + Send;

    /// Persist an automatically generated name only while the default remains.
    fn set_name_if_default(
        &self,
        id: AgentSessionId,
        name: &str,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Persist the sandbox size this session was spawned with, or resized to.
    fn set_sandbox_size(
        &self,
        id: AgentSessionId,
        size: SandboxSize,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The user's default sandbox size for new `@coder` sessions.
    ///
    /// A missing row is [`SandboxSize::Default`], not an error.
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

    /// Delete an agent session by id.
    fn delete(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;
}

/// The durable record of which provider-side agent an externally-served
/// session runs on.
///
/// Written by the provider's container manager when the agent is minted, read
/// back to resume after a restart, and joined into session reads so a client
/// can link out to the provider. Providers have no queryable label space
/// (Cursor's API cannot answer "which agent belongs to this session"), so
/// this repo is the mapping's single source of truth.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait ExternalSessionRepo: Send + Sync + 'static {
    /// Record (or refresh) a session's provider-side identity.
    ///
    /// Upsert on the session: a session has at most one external backing, and
    /// re-learning the same agent's name or url must not fail the write.
    fn upsert(
        &self,
        id: AgentSessionId,
        external: ExternalSession,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The session's provider-side identity, if it has one.
    fn get(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<Option<ExternalSession>>> + Send;

    /// Forget a session's provider-side identity. A session that never had
    /// one is already in the asked-for state, so this succeeds.
    fn delete(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;
}

/// How often a replica refreshes its heartbeat row.
pub const REPLICA_HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);

/// How stale a replica's heartbeat may be before its claims are up for
/// grabs. Three missed heartbeats: long enough that one slow write does not
/// get a live replica's sessions stolen, short enough that a crashed
/// replica's sessions resume on the next prompt rather than minutes later.
pub const REPLICA_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(30);

/// The session-management lease: which replica holds a session's live actor.
///
/// Implemented by the same store that persists the session log, never
/// separately - the fence a claim carries is checked by that store's fenced
/// appends, and minting fences in one place while checking them in another
/// is the mis-wiring this coupling forbids.
///
/// Claiming is a single conditional update (compare-and-swap): it succeeds
/// when the session is unmanaged, already ours, or held by a replica whose
/// heartbeat has gone stale, and every success increments the session's
/// fence. There are deliberately no explicit locks anywhere in the contract -
/// see [`ManagerFence`](super::model::ManagerFence) for why a fence, not a
/// lock, is what neutralizes a stale holder.
pub trait SessionOwnership: Send + Sync + 'static {
    /// Claim live management of a session for `replica`, registering the
    /// replica's heartbeat as a side effect so a claim can never dangle on a
    /// replica the store has not seen.
    fn claim(
        &self,
        session: AgentSessionId,
        replica: ReplicaId,
    ) -> impl Future<Output = Result<ClaimOutcome>> + Send;

    /// Release a claim this replica holds. Conditional on the claim's fence
    /// still being current: releasing after having been superseded is a
    /// no-op, never a theft of the successor's claim. A session already
    /// released (or deleted) is in the asked-for state, so this succeeds.
    fn release(&self, claim: &SessionClaim) -> impl Future<Output = Result<()>> + Send;

    /// Refresh this replica's heartbeat, upserting its row and publishing
    /// `address` - the base URL peers forward this replica's sessions'
    /// commands to - when one is known.
    fn heartbeat(
        &self,
        replica: ReplicaId,
        address: Option<&ReplicaAddress>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The live manager of a session, if a replica with a fresh heartbeat
    /// holds its lease. `None` covers both an unclaimed session and one whose
    /// holder has gone stale - either way the session is claimable.
    fn manager_of(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Option<SessionManager>>> + Send;
}

#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionLogRepo: Send + Sync + 'static {
    /// Append a log entry and project any system event onto the session status.
    fn create(
        &self,
        log: AgentSessionLog,
    ) -> impl Future<Output = Result<StoredAgentSessionLog>> + Send;

    /// [`create`](Self::create), conditioned on `claim` still holding the
    /// session's current fence.
    ///
    /// This is the write half of the fencing contract: the check and the
    /// append are one atomic statement, so a replica that stalled past its
    /// heartbeat and was superseded cannot interleave frames no matter when
    /// it wakes - its append matches nothing and fails with
    /// [`FencedOut`](super::error::AgentSessionError::FencedOut), which the
    /// actor treats as its cue to tear down.
    fn create_fenced(
        &self,
        log: AgentSessionLog,
        claim: &SessionClaim,
    ) -> impl Future<Output = Result<StoredAgentSessionLog>> + Send;

    /// List all log entries for a session, in chronological order.
    ///
    /// Entries come back stamped with when the log recorded them: the frame
    /// itself carries no time, and a reader ordering or merging a session's
    /// messages has nothing else to order them by.
    fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<StoredAgentSessionLog>>> + Send;
}

/// Sequential live log writer owned by one session actor.
pub trait AgentSessionLogWriter: Send + 'static {
    /// Persist and fold one frame into this connection's live projection.
    fn append(&mut self, log: AgentSessionLog) -> impl Future<Output = Result<()>> + Send;
}

/// A session's queue changed; this is the whole queue as it stands now.
///
/// A snapshot rather than a delta so that any one event is self-sufficient:
/// a viewer applies the newest one it has seen and needs nothing else.
#[derive(Debug, Clone)]
pub struct AgentSessionQueueChanged {
    /// The session whose queue this is.
    pub agent_session_id: AgentSessionId,
    /// Everything waiting, oldest (next to dispatch) first.
    pub entries: Vec<QueuedControl>,
}

/// Pushing a live session's frames to whoever is watching it.
///
/// Separate from the durable log: that is what a reader arriving late fetches
/// and folds, while this tells a client already looking at the session what
/// just happened, so it can fold the frame and redraw without refetching.
///
/// Best-effort by contract. A dropped frame costs a viewer some liveness until
/// they reload, and the log it was derived from is already durable - so an
/// implementation may drop, and callers must not fail an append over it.
pub trait AgentSessionRealtime {
    /// Publish one appended frame to the session's viewers.
    fn publish(
        &self,
        event: LogAppended,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// Publish a user-facing name change to the session's viewers.
    fn publish_renamed(
        &self,
        _event: AgentSessionRenamed,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send {
        async { Ok(()) }
    }

    /// Publish a session's changed queue - the whole queue, every time - to
    /// its viewers.
    fn publish_queue_changed(
        &self,
        _event: AgentSessionQueueChanged,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send {
        async { Ok(()) }
    }
}

/// Told when a session's turn ends and when its live actor stops.
///
/// What the harness gates its prompt queue on: a turn ending means the agent
/// can take the next queued prompt, an actor stopping means no turn is in
/// flight anymore however the last one looked. Both fire from the actor's own
/// task, so implementations must only hand the fact off - enqueue, notify -
/// never do the resulting work inline.
///
/// Object-safe and synchronous on purpose: the service stores it erased so
/// wiring it is not another type parameter, and the one production
/// implementation admits work to a queue synchronously.
pub trait SessionTurnObserver: Send + Sync + 'static {
    /// The runtime answered the session's in-flight turn.
    fn turn_ended(&self, id: AgentSessionId);

    /// The session's live actor is gone - disconnect, teardown, or crash. Any
    /// in-flight turn went with it, without [`Self::turn_ended`] firing.
    fn session_stopped(&self, id: AgentSessionId);
}

impl<T: SessionTurnObserver + ?Sized> SessionTurnObserver for std::sync::Arc<T> {
    fn turn_ended(&self, id: AgentSessionId) {
        (**self).turn_ended(id);
    }

    fn session_stopped(&self, id: AgentSessionId) {
        (**self).session_stopped(id);
    }
}

/// A [`SessionTurnObserver`] for services with no queue above them: tests,
/// offline tooling, and replay.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpTurnObserver;

impl SessionTurnObserver for NoOpTurnObserver {
    fn turn_ended(&self, _id: AgentSessionId) {}

    fn session_stopped(&self, _id: AgentSessionId) {}
}

/// A [`SessionTurnObserver`] bound after construction, for the composition
/// root's chicken-and-egg: the session service wants its observer at build
/// time, and the observer (the harness) is built *from* the session service.
///
/// Events before `bind` are dropped. That window is the instants between the
/// two constructions, before anything serves traffic - nothing turns then.
#[derive(Default)]
pub struct LateBoundTurnObserver {
    observer: std::sync::OnceLock<Box<dyn SessionTurnObserver>>,
}

impl LateBoundTurnObserver {
    /// An observer awaiting its target.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Attach the real observer. A second bind is a wiring bug; the first
    /// stays authoritative and the duplicate is dropped.
    pub fn bind(&self, observer: impl SessionTurnObserver) {
        let _ = self.observer.set(Box::new(observer));
    }
}

impl SessionTurnObserver for LateBoundTurnObserver {
    fn turn_ended(&self, id: AgentSessionId) {
        if let Some(observer) = self.observer.get() {
            observer.turn_ended(id);
        }
    }

    fn session_stopped(&self, id: AgentSessionId) {
        if let Some(observer) = self.observer.get() {
            observer.session_stopped(id);
        }
    }
}

/// Generates a concise display name from a session's first prompt.
pub trait AgentSessionNameGenerator: Send + Sync + 'static {
    /// Generate a name, or `None` when naming is disabled for this service.
    fn generate_name(
        &self,
        session: &AgentSession,
        initial_prompt: &str,
    ) -> impl Future<Output = Result<Option<String>, rootcause::Report>> + Send;
}

/// Disables automatic agent-session naming.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpAgentSessionNameGenerator;

impl AgentSessionNameGenerator for NoOpAgentSessionNameGenerator {
    async fn generate_name(
        &self,
        _session: &AgentSession,
        _initial_prompt: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        Ok(None)
    }
}

/// An [`AgentSessionRealtime`] that streams nowhere.
///
/// Dropping every frame is a legal implementation of the port - it is
/// best-effort by contract - so this is what a writer with no viewers to serve
/// gets: `seed_jsonl` replaying a recording into the database, and tests that
/// are asserting on the durable side of an append.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpRealtime;

impl AgentSessionRealtime for NoOpRealtime {
    async fn publish(&self, _event: LogAppended) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

/// One control operation, and who is responsible for it.
#[derive(Debug, Clone)]
pub struct ControlEvent {
    /// What the agent was asked to do.
    pub action: AgentAction,
    /// The user responsible, absent when a bot acted on nobody's behalf.
    ///
    /// `None` means "no user is responsible", not "unknown" - a bot's own
    /// actions are attributed to the bot, which this field does not carry.
    pub actor: Option<MacroUserIdStr<'static>>,
}

/// What accepting a control operation did with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlDisposition {
    /// The action reached the agent's runtime.
    Sent,
    /// A turn was running, so the action waits in the session's queue and
    /// dispatches when that turn ends. Until then it can be listed, edited,
    /// and removed under its action id.
    Queued,
}

/// A control operation the recipient accepted: the id a caller correlates
/// with, and what became of it.
#[derive(Debug, Clone)]
pub struct AcceptedControl {
    /// Matches `requestId` on the folded message the action derives once it
    /// dispatches, and names the queue entry until then.
    pub action_id: AgentActionId,
    /// Whether it went out or waits.
    pub disposition: ControlDisposition,
}

/// One action waiting in a session's queue, as a reader sees it.
#[derive(Debug, Clone)]
pub struct QueuedControl {
    /// The id the action was accepted under.
    pub action_id: AgentActionId,
    /// What will be delivered - a prompt's text is the raw user text, which
    /// is what editing replaces.
    pub action: AgentAction,
    /// The user who queued it, absent when a bot acted on nobody's behalf.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// When it was accepted.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Whoever holds a session's live resources, told when the durable session
/// changes in a way those resources have to follow.
///
/// In-process today: a session's actor and its container live in one address
/// space, so only the process that opened the session can act on this. The
/// port exists so that coupling is named rather than assumed, and so the
/// control routes can be mounted against it without knowing what a harness is.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionNotificationRecipient: Send + Sync + 'static {
    /// The session is going away: release its live resources and delete it.
    fn session_deleted(&self, id: AgentSessionId) -> impl Future<Output = Result<()>> + Send;

    /// A control operation the live connection has to be told about. Returns
    /// the action id the caller correlates against the fold stream, and
    /// whether the action went out or waits in the session's queue.
    fn control_event(
        &self,
        id: AgentSessionId,
        event: ControlEvent,
    ) -> impl Future<Output = Result<AcceptedControl>> + Send;

    /// The actions waiting in this session's queue, oldest first.
    fn queued_controls(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<QueuedControl>>> + Send;

    /// Replace a queued prompt's text. [`AgentSessionError::QueuedControlNotFound`]
    /// once it has dispatched; [`AgentSessionError::QueuedControlNotEditable`]
    /// for a queued action that carries no text.
    ///
    /// `actor` is the user responsible, judged by the same gates as sending:
    /// whoever may not prompt a session may not rewrite what it is about to
    /// be prompted with.
    fn edit_queued_control(
        &self,
        id: AgentSessionId,
        action_id: AgentActionId,
        prompt: String,
        actor: Option<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Remove a queued action before it dispatches.
    /// [`AgentSessionError::QueuedControlNotFound`] once it has. `actor` as
    /// on [`Self::edit_queued_control`].
    fn remove_queued_control(
        &self,
        id: AgentSessionId,
        action_id: AgentActionId,
        actor: Option<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Resize this session's sandbox and remember `size` as the owner's default.
    fn set_sandbox_size(
        &self,
        id: AgentSessionId,
        size: SandboxSize,
    ) -> impl Future<Output = Result<()>> + Send;

    /// The harness currently bound to serve this session, resolved through its
    /// bot's binding. `None` for a managed session or an unbound bot.
    ///
    /// The control routes use it to confine a harness caller to the sessions
    /// its own daemon serves: ownership alone would let a harness that merely
    /// acts for a user drive or delete sessions another harness serves for the
    /// same user.
    fn session_harness(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<Option<harness_id::HarnessId>>> + Send;
}
