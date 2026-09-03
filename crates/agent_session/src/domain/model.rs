use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use bots::domain::models::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

// The log vocabulary - the session id, the log entry, and the frame it
// carries - is owned by `agent_fold`, the bottom of the agent session stack,
// so that this crate can depend on the fold (see `agent_fold::domain::log`).
// Re-exported here because this is where callers expect session types.
pub use super::sandbox_size::SandboxSize;
pub use agent_fold::domain::log::{AgentSessionId, AgentSessionLog, Message};
pub use agent_fold::domain::model::{
    Author, AuthorKind, FoldEvent, MessageId, OwnedFoldEvent, TurnId,
};

/// Identity of one harness participant, minted fresh at construction.
///
/// A restarted process is a new replica: whatever the old identity claimed is
/// released by its heartbeat going stale, never inherited.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ReplicaId(Uuid);

impl ReplicaId {
    /// Mint a fresh replica identity.
    #[must_use]
    pub fn mint() -> Self {
        Self(Uuid::new_v4())
    }

    /// The raw uuid, for persistence.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }

    /// Rebuild an identity from its persisted uuid.
    #[must_use]
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl std::fmt::Display for ReplicaId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// A replica's own base URL, as peers should dial it for command forwarding.
///
/// Private-network address discovered by the replica itself at boot (the ECS
/// task metadata endpoint in deployments), published with its heartbeat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicaAddress(String);

impl ReplicaAddress {
    /// Wrap a base URL, e.g. `http://10.0.1.7:8100`.
    #[must_use]
    pub fn new(address: impl Into<String>) -> Self {
        Self(address.into())
    }

    /// The base URL as a string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ReplicaAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// The live manager of a session, as read from the lease.
#[derive(Debug, Clone)]
pub struct SessionManager {
    /// The replica holding the claim.
    pub replica: ReplicaId,
    /// Where to forward its commands, when the replica has published one.
    /// `None` means the manager is live but unreachable - hold the error
    /// rather than execute somewhere the actor is not.
    pub address: Option<ReplicaAddress>,
}

/// Where a session's live actor runs, from one service instance's viewpoint.
#[derive(Debug, Clone)]
pub enum SessionManagement {
    /// No live replica manages the session; this instance may claim it by
    /// attaching, so commands execute locally.
    Unmanaged,
    /// This instance's replica manages it; commands execute locally.
    Ours,
    /// A live peer manages it; commands belong at its address.
    Peer(SessionManager),
}

/// A session's takeover counter, bumped by every successful claim.
///
/// Carried by the claim holder into each live-actor write; the store rejects
/// writes whose fence has been superseded, so a stale holder is neutralized
/// by the same statement that would have written (a fencing token).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ManagerFence(pub i64);

/// Proof that this replica claimed a session's live management.
///
/// Obtained only from [`SessionOwnership::claim`](super::ports::SessionOwnership::claim);
/// holding one is what entitles an actor to attach and write the session's
/// log under its fence.
#[derive(Debug, Clone, Copy)]
pub struct SessionClaim {
    /// The claimed session.
    pub session: AgentSessionId,
    /// The replica holding the claim.
    pub replica: ReplicaId,
    /// The fence this claim writes under.
    pub fence: ManagerFence,
}

/// What claiming a session yielded.
#[derive(Debug, Clone, Copy)]
pub enum ClaimOutcome {
    /// This replica now manages the session.
    Claimed(SessionClaim),
    /// A replica with a fresh heartbeat already manages it. Until command
    /// forwarding exists this surfaces as an error; with it, commands are
    /// routed to the named replica instead.
    ManagedElsewhere(ReplicaId),
}

/// Display name assigned to a newly created agent session.
pub const DEFAULT_AGENT_SESSION_NAME: &str = "Agent Session";

/// Maximum number of Unicode scalar values in a session name.
pub const MAX_AGENT_SESSION_NAME_CHARS: usize = 100;

#[derive(Debug, Clone, Default, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SessionStatus {
    /// No status updates received.
    #[default]
    NoMessages,
    /// The latest status received from the container.
    Event(SystemEvent),
    /// The session disconnected without sending a closed event.
    Disconnected,
}

/// Caller-provided values required to create an agent session.
#[derive(Debug, Clone)]
pub struct CreateAgentSessionParams {
    /// Caller-minted session id, available before persistence.
    pub id: AgentSessionId,
    /// User who created and owns the session.
    pub owner_id: MacroUserIdStr<'static>,
    /// Bot running the agent.
    pub bot_id: BotId,
    /// Root message identifying the originating thread, if any.
    pub thread_id: Option<Uuid>,
    /// Exact message that invoked the bot, if any.
    pub originating_message_id: Option<Uuid>,
    /// Model slug.
    pub model: String,
    /// Harness slug.
    pub harness: String,
    /// Repository the agent works with, when one was stated.
    pub repo_url: Option<String>,
    /// Absolute directory the harness runs in on its runtime.
    pub workspace: String,
    /// Compute tier the managed sandbox was spawned with.
    pub sandbox_size: SandboxSize,
    /// Instructions the session's runtime works under, when any were stated.
    ///
    /// Snapshotted here rather than resolved per turn because they are the
    /// runtime's system prompt: how a harness is handed them differs by
    /// provider, but every provider needs the same answer for the session's
    /// whole life.
    pub instructions: Option<String>,
    /// SHA-256 hex of the opaque token the session's sandbox presents to the
    /// egress proxy, or `None` for a session that never gets one.
    ///
    /// The hash and never the token: this row is the only durable record of
    /// the credential, and a database dump must not yield a live one. A session
    /// replayed from a recording, or created without a sandbox, has nothing to
    /// store here.
    pub egress_token_hash: Option<String>,
}

/// A running or historical agent coding session.
#[derive(Debug, Clone)]
pub struct AgentSession {
    /// id of the agent session
    pub id: AgentSessionId,
    /// User-facing session name.
    pub name: String,
    /// The user who created and owns the session. Immutable for its life.
    pub owner_id: MacroUserIdStr<'static>,
    /// The root message where the bot was originally invoked, if any.
    pub thread_id: Option<Uuid>,
    /// The channel `thread_id` lives in, when the session was spawned from a
    /// thread. Derived from the thread root's message row rather than
    /// stored — the message's channel is authoritative.
    pub thread_channel_id: Option<Uuid>,
    /// The exact message that originally invoked the bot, if any.
    pub originating_message_id: Option<Uuid>,
    /// the bot id of the bot running the agent
    pub bot_id: BotId,
    /// model slug - TODO: probably a better type here
    pub model: String,
    /// harness slug - TODO: probably a better type here
    pub harness: String,
    /// repo we are working with, when one was stated
    pub repo_url: Option<String>,
    /// Directory the harness runs in, snapshotted at creation. The session
    /// actor sends it as the working directory of `session/new`, and resume
    /// and load re-enter it - the directory the session actually ran in,
    /// not whatever the runtime is configured with today.
    pub workspace: String,
    /// Compute tier of the managed sandbox, snapshotted at spawn.
    pub sandbox_size: SandboxSize,
    /// Instructions the session's runtime works under, snapshotted at
    /// creation. Immutable for the session's life; `None` when none were
    /// stated.
    pub instructions: Option<String>,
    /// ACP session if we have one
    pub acp_session_id: Option<SessionId>,
    /// The provider-side identity, when an external provider serves this
    /// session. `None` for sandboxed sessions and for external sessions
    /// whose agent has not been minted yet.
    pub external: Option<ExternalSession>,
    pub status: SessionStatus,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
}

/// A persisted agent-session name changed and should be shown to live viewers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSessionRenamed {
    /// Renamed session.
    pub agent_session_id: AgentSessionId,
    /// New user-facing name.
    pub name: String,
}

/// The provider-side identity of a session served by an external provider.
///
/// For a Cursor-backed session this is the cloud agent: its `bc-…` id, the
/// display name Cursor derived from the prompt, and its page on cursor.com.
/// The stored row is the only durable record of the mapping — Cursor's API
/// has no labels to recover it from — which is why this exists as data
/// rather than being re-derived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalSession {
    /// Which provider serves the session, e.g. `cursor`.
    pub provider: String,
    /// The provider's id for the agent, e.g. `bc-…`.
    pub external_id: String,
    /// The provider's display name for the agent, when it reported one.
    pub external_name: Option<String>,
    /// The agent's page on the provider's site, for opening it there.
    pub external_url: Option<String>,
}

/// The agent behind a session, as much of it as rendering a message needs.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionBot {
    /// The bot's id. A message it sent has `"bot|{id}"` as its sender.
    pub id: BotId,
    /// Display name.
    pub name: String,
    /// Avatar, when it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

/// One action waiting in a session's queue.
///
/// Clients deserialize this, so both derives are used.
// Domain-owned because the queue GET endpoint and the realtime snapshot
// serialize this type byte-identically; that identity is the client contract.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueuedActionDto {
    /// The id the action was accepted under.
    pub action_id: agent_runtime_protocol::domain::action::AgentActionId,
    /// What kind of action waits - `prompt` or `compact`; only
    /// turn-occupying actions are ever queued.
    pub kind: String,
    /// The prompt's raw text, present for prompts only. What an edit
    /// replaces.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// The user who queued it, absent when a bot acted on nobody's behalf.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_user_id: Option<String>,
    /// When it was accepted.
    pub created_at: DateTime<Utc>,
}

impl From<super::ports::QueuedControl> for QueuedActionDto {
    fn from(queued: super::ports::QueuedControl) -> Self {
        use agent_runtime_protocol::domain::action::AgentAction;
        let prompt = match &queued.action {
            AgentAction::Prompt(action) => Some(action.prompt.clone()),
            _ => None,
        };
        Self {
            action_id: queued.action_id,
            kind: queued.action.as_ref().to_owned(),
            prompt,
            actor_user_id: queued.actor.map(|actor| actor.to_string()),
            created_at: queued.created_at,
        }
    }
}

/// One frame appended to a live session's log, for anyone watching.
///
/// The streaming counterpart of [`SessionLog`]: that is the whole log
/// for a reader arriving late, this is one frame for a reader already here.
/// Both carry the same entry shape, so a client folds them the same way -
/// catching up on the log and then following it is one fold, not two.
///
/// Addressed by session: it is the only thing a frame belongs to now that a
/// session does not own a channel.
#[derive(Debug, Clone)]
pub struct LogAppended {
    /// The session the entry belongs to. The fold keys its messages on this,
    /// so a client must pass it through unchanged.
    pub agent_session_id: AgentSessionId,
    /// The frame and the timestamp assigned when it was stored.
    pub entry: StoredAgentSessionLog,
}

/// One entry of a session's log as it was stored, with the time the log
/// recorded it.
///
/// [`AgentSessionLog`] is the frame a writer hands in, and a frame carries no
/// time of its own - `created_at` only exists once the row does. It is kept
/// beside the frame rather than folded into it so the fold's vocabulary stays
/// exactly what a client can replay, while a reader that has to order or merge
/// a session's messages against anything else still has something to order by.
#[derive(Debug, Clone)]
pub struct StoredAgentSessionLog {
    /// When the entry was appended to the log.
    pub created_at: DateTime<Utc>,
    /// The frame, exactly as the log stored it.
    pub entry: AgentSessionLog,
}

/// A session's raw protocol log.
///
/// Served rather than the messages it derives: the reader folds it. The web
/// client runs the same fold compiled to WASM, so a streamed session and a
/// reloaded one are rendered by one implementation rather than two that have
/// to be kept agreeing.
#[derive(Debug, Clone)]
pub struct SessionLog {
    /// The agent whose messages the log derives.
    ///
    /// Sent because a reader has to render those messages and cannot work out
    /// who sent them: the sender of an agent message is this session's bot,
    /// and nothing else names it.
    pub bot: SessionBot,
    /// Every logged frame, oldest first. Folding depends on this order.
    pub entries: Vec<StoredAgentSessionLog>,
}

/// How an incoming channel context relates to an agent session.
///
/// Only the originating thread can match: sessions no longer own a dedicated
/// channel, so there is no channel that is itself a session. Messages sent
/// directly to a session arrive through their own topic, not as channel
/// events, and never pass through this lookup.
#[derive(Debug, Clone)]
#[allow(
    clippy::large_enum_variant,
    reason = "one data variant against None; boxing would only move the size"
)]
pub enum ChannelSession {
    /// No session matched the channel context.
    None,
    /// The bot's session was created from the incoming thread.
    CreatedFromThread(AgentSession),
}
