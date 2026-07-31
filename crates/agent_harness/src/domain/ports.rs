//! Ports the mention use case depends on.
//!
//! Deliberately few, because the harness delegates almost everything about a
//! *session* to agent_proxy and keeps only what nothing else does:
//!
//! - [`SandboxProvider`] / [`AgentSandbox`] - provisioning containers, ours alone
//! - [`RuntimeAttachments`] - handing a container's connection to whatever
//!   manages sessions, which is the entire seam to agent_proxy
//! - [`AgentSessionStore`] - the `(bot, thread) -> chat` mapping, which is a
//!   channel concept agent_proxy has no notion of
//! - [`ChannelReplier`] - posting the link back
//!
//! What is *not* here is anything about ACP: no bootstrap, no frame relay, no
//! event log. agent_proxy performs `initialize`/`session/new`, flushes prompts
//! queued before the runtime was ready, persists frames as chat messages, and
//! streams them to clients. The harness boots a container and hands over the
//! wire.

use std::future::Future;

use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::channel::Channel;
use agent_runtime_protocol::domain::connection::ServerChannel;
use bot_id::BotId;
use macro_uuid::Uuid;

use channels::domain::side_effects::ChannelBotTrigger;

use crate::domain::models::{AgentSession, AgentSessionStatus, ThreadSession};

/// The ACP frame stream of a sandbox's harness: raw JSON-RPC messages in
/// both directions. Adapters own transport and framing (the Daytona adapter
/// speaks NDJSON over the sidecar's WebSocket); consumers only ever see
/// typed frames.
pub type AcpFrames = Channel<RawJsonRpcMessage, RawJsonRpcMessage>;

/// One provisioned sandbox hosting an ACP harness.
pub trait AgentSandbox: Send + Sync + 'static {
    /// The provider's identifier for this sandbox.
    fn id(&self) -> &str;

    /// Open the ACP frame stream to the harness. Callable more than once:
    /// reconnects open a fresh stream to the same sandbox.
    fn connect(&self) -> impl Future<Output = anyhow::Result<AcpFrames>> + Send;

    /// Return the sandbox to the provider. No pooling providers exist today,
    /// so releasing destroys.
    fn release(&self) -> impl Future<Output = ()> + Send;
}

/// Provisions sandboxes for agent runs.
pub trait SandboxProvider: Send + Sync + 'static {
    /// The sandbox type this provider hands out.
    type Sandbox: AgentSandbox;

    /// Create a sandbox, bring it to ready (repo cloned, sidecar answering
    /// its readiness probe), and hand it out.
    ///
    /// Takes no arguments while every run clones the same repository.
    /// Per-run spawn parameters (repo, branch, image) reappear as an options
    /// struct when there are any.
    fn spawn(&self) -> impl Future<Output = anyhow::Result<Self::Sandbox>> + Send;
}

/// What a new agent session needs to be created with.
///
/// `model`, `harness`, and `repo_url` are all per-session columns, so they are
/// arguments rather than constants - even though today every value comes from
/// this deployment's own configuration.
#[derive(Debug, Clone)]
pub struct NewAgentSession {
    /// Thread the triggering mention was posted in, if any.
    pub created_from_thread_id: Option<Uuid>,
    /// Bot the session answers for.
    pub bot_id: BotId,
    /// Model the agent runs.
    pub model: String,
    /// Which harness runs the agent.
    pub harness: String,
    /// Repository cloned into the sandbox.
    pub repo_url: String,
}

/// Reads and writes `agent_sessions`.
///
/// The lookup is the interesting one and is deliberately a single call: for an
/// incoming message it answers "is there a session, do I own it, and was it
/// created at this thread or is this a message in the session's own orphaned
/// thread" in one query, so the use case branches on a value rather than
/// assembling that answer from several round trips.
///
/// Uniqueness of one session per bot per thread is the store's invariant to
/// enforce, not the caller's: two mentions of the same bot in the same thread
/// can be processed concurrently off different Kafka partitions, so
/// [`AgentSessionStore::create`] has to lose that race deterministically rather
/// than leave two rows behind.
pub trait AgentSessionStore: Send + Sync + 'static {
    /// Resolve the session state for `bot_id` given the thread a message
    /// arrived in.
    fn find_for_thread(
        &self,
        bot_id: BotId,
        thread_id: Option<Uuid>,
    ) -> impl Future<Output = anyhow::Result<ThreadSession>> + Send;

    /// Create a session and the orphaned thread it lives in.
    fn create(
        &self,
        session: NewAgentSession,
    ) -> impl Future<Output = anyhow::Result<AgentSession>> + Send;

    /// Move a session to a new lifecycle state.
    fn set_status(
        &self,
        id: Uuid,
        status: AgentSessionStatus,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Hands a container's runtime connection to whatever manages the session.
///
/// This is the whole boundary to agent_proxy. Once a connection is attached,
/// its `RuntimeConnectionDriver` owns the ACP bootstrap, the prompt queue, and
/// persistence - so the harness never constructs an ACP message.
///
/// The channel is `agent_runtime_protocol`'s server-side endpoint, which is
/// what the driver expects; a physical transport is not involved, because the
/// harness and the session manager run in one process.
pub trait RuntimeAttachments: Send + Sync + 'static {
    /// Attach `channel` as the runtime connection for `session_id`.
    ///
    /// Returns once the connection is handed over, not once ACP is ready:
    /// bootstrap happens on the other side, asynchronously.
    fn attach(&self, session_id: Uuid, channel: ServerChannel) -> anyhow::Result<()>;
}

/// Posts the harness's replies back into the channel a mention came from.
///
/// Always into [`crate::domain::models::reply_thread_id`], so a top-level
/// mention gets a new thread hanging off it and a mention already in a thread
/// gets another message in that thread.
///
/// Posts are sent as the harness bot, not as the person who mentioned it.
///
/// Returns the posted message's id, which is not a convenience: a session's
/// `thread_id` references `comms_messages`, so the row cannot be written until
/// some message anchors its thread. The reply is that message.
pub trait ChannelReplier: Send + Sync + 'static {
    /// Post `body` in reply to `trigger`'s message, and return the new
    /// message's id.
    fn reply(
        &self,
        trigger: &ChannelBotTrigger,
        body: String,
    ) -> impl Future<Output = anyhow::Result<Uuid>> + Send;
}
