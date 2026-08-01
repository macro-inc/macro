//! Ports the mention use case depends on.
//!
//! Deliberately few, because the harness delegates: sessions are persisted by
//! `agent_session`, and ACP is driven by whatever implements
//! [`RuntimeAttachments`]. What is left is what nothing else does:
//!
//! - [`SandboxProvider`] / [`AgentSandbox`] - provisioning containers, ours alone
//! - [`RuntimeAttachments`] - handing a container's connection to whatever
//!   manages sessions, which is the entire seam to agent_proxy
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
use macro_uuid::Uuid;

use channels::domain::side_effects::ChannelBotTrigger;

/// The ACP frame stream of a sandbox's harness: raw JSON-RPC messages in
/// both directions. Adapters own transport and framing (the Daytona adapter
/// speaks NDJSON over the sidecar's WebSocket); consumers only ever see
/// typed frames.
pub type AcpFrames = Channel<RawJsonRpcMessage, RawJsonRpcMessage>;

/// A provider's stable identifier for one container.
///
/// Stable across reconnects and across harness restarts, which is what makes
/// resumption possible: persist this with the session and a later process can
/// call [`SandboxProvider::resume`] instead of paying to boot a fresh container
/// and losing the agent's working state.
///
/// Opaque on purpose - Daytona's sandbox ids and Namespace's instance ids share
/// no format, and nothing outside a provider should parse one.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContainerId(String);

impl ContainerId {
    /// Wrap a provider-issued identifier.
    #[must_use]
    pub fn new(id: String) -> Self {
        Self(id)
    }

    /// The identifier as the provider issued it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ContainerId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// One provisioned sandbox hosting an ACP harness.
pub trait AgentSandbox: Send + Sync + 'static {
    /// The provider's identifier for this sandbox.
    fn id(&self) -> &ContainerId;

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

    /// Reattach to a container this provider handed out earlier.
    fn resume(
        &self,
        id: &ContainerId,
    ) -> impl Future<Output = anyhow::Result<Self::Sandbox>> + Send;
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

/// Posts messages into channel threads as the harness bot.
///
/// The target thread is an argument rather than something derived from the
/// trigger, because a run writes to two different threads and the split is
/// deliberate:
///
/// - the thread the mention came from gets **exactly one** message, the link to
///   the agent session, so a busy channel is not filled with progress chatter
/// - the session's **own** thread gets everything else - progress, output, the
///   run's history - because that thread exists only to hold this run
///
/// Posts are sent as the harness bot, attributed via `triggered_by` to the
/// person who asked, so it reads as their agent answering rather than a bot
/// talking unprompted.
///
/// Returns the posted message's id, which is not a convenience: a session's
/// `thread_id` references `comms_messages`, so the row cannot be written until
/// some message anchors its thread. The link message is that anchor.
pub trait ChannelReplier: Send + Sync + 'static {
    /// Post `body` into `thread_id`, on behalf of whoever sent `trigger`.
    fn post(
        &self,
        trigger: &ChannelBotTrigger,
        thread_id: Uuid,
        body: String,
    ) -> impl Future<Output = anyhow::Result<Uuid>> + Send;
}
