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

#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait AgentSessionLogRepo: Send + Sync + 'static {
    /// Append a log entry and project any system event onto the session status.
    fn create(
        &self,
        log: AgentSessionLog,
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
    /// the action id the caller correlates against the fold stream.
    fn control_event(
        &self,
        id: AgentSessionId,
        event: ControlEvent,
    ) -> impl Future<Output = Result<AgentActionId>> + Send;

    /// Resize this session's sandbox and remember `size` as the owner's default.
    fn set_sandbox_size(
        &self,
        id: AgentSessionId,
        size: SandboxSize,
    ) -> impl Future<Output = Result<()>> + Send;
}
