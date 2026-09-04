//! Outbound capabilities required by the harness domain.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::model::{AgentSessionId, ReplicaAddress, ReplicaId, SandboxSize};
use agent_session::domain::ports::AgentConnector;
use bot_id::BotId;
use harness_id::HarnessId;

use macro_user_id::user_id::MacroUserIdStr;

use super::error::{HarnessError, Result};
use super::model::{
    AgentRuntimeConfig, CommandOutcome, ForwardedCommand, PriorChannelMessage, ProvisionedEgress,
    RuntimeOwner, SandboxEgress, SessionAnnouncement, SpawnContainer,
};
use super::sandbox::SandboxResizeEffect;

/// Delivers a session's command to the replica that manages its live actor.
///
/// The receiving side executes without re-resolving management (a forward is
/// single-hop by contract, so two replicas with momentarily different views
/// cannot bounce a command between each other). Success means the peer ran
/// the command to completion - the response is the acknowledgment - so a
/// caller that awaited a forward has the same guarantee as one that executed
/// locally.
pub trait CommandForwarder: Send + Sync + 'static {
    /// Run `command` for `session` on the replica at `target`, reporting
    /// what that replica's execution did with it.
    fn forward(
        &self,
        target: &ReplicaAddress,
        session: AgentSessionId,
        command: ForwardedCommand,
    ) -> impl Future<Output = Result<CommandOutcome>> + Send;
}

/// A forwarder for deployments with exactly one replica, where a live peer
/// cannot exist: being asked to forward is itself the error, loudly, rather
/// than a silent local fallback that would mask a mis-wiring.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoPeers;

impl CommandForwarder for NoPeers {
    async fn forward(
        &self,
        target: &ReplicaAddress,
        session: AgentSessionId,
        _command: ForwardedCommand,
    ) -> Result<CommandOutcome> {
        Err(HarnessError::Forward(rootcause::report!(
            "this deployment has no command forwarding, yet {target} manages session {session}"
        )))
    }
}

#[cfg(test)]
mod test;

/// Resolves which registered harness currently serves a bot's sessions.
///
/// Resolved at bind time, not stamped at session creation, so rebinding an
/// agent to another harness re-routes its existing sessions.
pub trait HarnessBindings: Send + Sync + 'static {
    /// The bot's current harness binding, or `None` for an unbound bot.
    fn harness_for(
        &self,
        bot: BotId,
    ) -> impl Future<Output = anyhow::Result<Option<HarnessId>>> + Send;
}

/// Durable, exclusive ownership of externally hosted runtime sockets.
pub trait RuntimeLease: Send + Sync + 'static {
    /// Claim a harness socket token, returning false when a fresh owner exists.
    fn claim(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>>;
    /// Promote this exact pending claim before publishing its socket locally.
    fn activate(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>>;
    /// Release this exact token, never a newer redial.
    fn release(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>>;
    /// Find a fresh owner for a harness. The local registry waits briefly for
    /// a pending owner to finish its WebSocket upgrade before declaring it
    /// disconnected.
    fn owner(
        &self,
        harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Option<RuntimeOwner>>> + Send>>;
}

impl<T: RuntimeLease + ?Sized> RuntimeLease for Arc<T> {
    fn claim(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        (**self).claim(harness, replica, connection_id)
    }

    fn activate(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        (**self).activate(harness, replica, connection_id)
    }

    fn release(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> {
        (**self).release(harness, replica, connection_id)
    }

    fn owner(
        &self,
        harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Option<RuntimeOwner>>> + Send>> {
        (**self).owner(harness)
    }
}

/// A lease directory for isolated tests and single-process tooling.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoRuntimeLease;

impl RuntimeLease for NoRuntimeLease {
    fn claim(
        &self,
        _harness: HarnessId,
        _replica: ReplicaId,
        _connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        Box::pin(async { Ok(true) })
    }
    fn activate(
        &self,
        _harness: HarnessId,
        _replica: ReplicaId,
        _connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        Box::pin(async { Ok(true) })
    }
    fn release(
        &self,
        _harness: HarnessId,
        _replica: ReplicaId,
        _connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> {
        Box::pin(async { Ok(()) })
    }
    fn owner(
        &self,
        _harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Option<RuntimeOwner>>> + Send>> {
        Box::pin(async { Ok(None) })
    }
}

/// Resolves the runtime configuration for a bot that may receive agent
/// session triggers.
pub trait AgentRuntimeDirectory: Send + Sync + 'static {
    /// Return a runtime profile for a managed agent, an external profile for a
    /// BYOA bot, or `None` when the bot has no agent configuration.
    fn runtime_for(
        &self,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Option<AgentRuntimeConfig>>> + Send;
}

/// Loads messages preceding a channel-originated agent prompt.
pub trait ChannelPromptContext: Send + Sync + 'static {
    /// Verify that a user who triggered a prompt remains a channel member.
    fn authorize_member(
        &self,
        actor: &macro_user_id::user_id::MacroUserIdStr<'static>,
        channel_id: macro_uuid::Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Return up to ten non-deleted messages immediately before `message_id`
    /// in chronological order.
    fn preceding_messages(
        &self,
        channel_id: macro_uuid::Uuid,
        message_id: macro_uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<PriorChannelMessage>>> + Send;
}

/// Composes an agent prompt from raw markdown and optional channel history.
pub trait AgentPromptComposer: Send + Sync + 'static {
    /// Return the markdown that should be delivered to the agent runtime.
    /// `None` sanitizes a prompt without adding a channel-context node.
    fn compose(
        &self,
        prompt_markdown: &str,
        messages: Option<&[PriorChannelMessage]>,
    ) -> impl Future<Output = Result<String>> + Send;
}

/// Posts a pointer to a new agent session into its originating thread.
pub trait SessionAnnouncer: Send + Sync + 'static {
    /// Publish one session announcement.
    fn announce(
        &self,
        announcement: SessionAnnouncement,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Where a session finds its bot's live runtime connection.
///
/// A self-hosted runtime dials once and carries every session its bot is
/// serving, so binding a session to a connection happens when work arrives for
/// it rather than when the runtime dials. That is what keeps a reconnect cheap:
/// sessions nobody is prompting are never restored at all, and the one being
/// prompted restores itself on the way to being prompted.
/// Only binding: taking a dialed-in socket into the registry is the inbound
/// adapter's business, and the type it hands over is not the type a session
/// talks through.
pub trait RuntimeConnections: Send + Sync + 'static {
    /// Transport one session on a shared connection talks through.
    type Connector: AgentConnector;

    /// Bind `session` onto `bot`'s connection, or `None` if it has none.
    ///
    /// Rebinding replaces, so this is for a session with no live actor - one
    /// that has just been prompted after a reconnect, or for the first time.
    fn bind(
        &self,
        bot: BotId,
        session: AgentSessionId,
    ) -> impl Future<Output = Option<RuntimeBinding<Self::Connector>>> + Send;

    /// The harness a bot's sessions currently bind to, without attaching
    /// anything. `None` for an unbound bot. Same resolution as [`bind`], for
    /// callers that need to know which harness serves a bot rather than to
    /// route to it.
    fn bound_harness(
        &self,
        bot: BotId,
    ) -> impl Future<Output = anyhow::Result<Option<HarnessId>>> + Send;

    /// The fresh owner for a harness's runtime socket.
    fn runtime_owner(
        &self,
        harness: HarnessId,
    ) -> impl Future<Output = anyhow::Result<Option<RuntimeOwner>>> + Send;

    /// Whether this process holds the locally attached socket for `harness`.
    fn owns_runtime(&self, harness: HarnessId, owner: &RuntimeOwner) -> bool;

    /// Whether `owner` names this replica, including a socket still upgrading.
    fn is_local_runtime_owner(&self, owner: &RuntimeOwner) -> bool;

    /// Whether missing durable ownership must block external command execution.
    fn requires_runtime_owner(&self) -> bool;
}

/// A session attachment and the exact durable socket authorizing its claim.
pub struct RuntimeBinding<Connector> {
    /// Session-scoped transport attachment.
    pub attachment: RuntimeAttachment<Connector>,
    /// Harness owning the shared socket.
    pub harness: HarnessId,
    /// Exact shared socket token, nil when durable routing is disabled.
    pub connection_id: macro_uuid::Uuid,
}

/// Mints the one secret a sandbox is given, and the config that points it at
/// the egress proxy.
///
/// A port rather than domain code because both halves are adapter work the
/// domain has no business knowing: signing a JWT needs a key, and enumerating
/// the owner's MCP servers needs their rows. What the domain keeps is *when* -
/// once, at spawn, for the session's own owner.
pub trait SandboxEgressProvisioner: Send + Sync + 'static {
    /// The egress environment for one session, on behalf of `owner`, and the
    /// hash its session row must carry for that environment to mean anything.
    fn provision(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        repo_url: &str,
    ) -> impl Future<Output = Result<ProvisionedEgress>> + Send;

    /// The egress environment rebuilt around a token that already exists.
    ///
    /// For reattaching to a sandbox that was spawned earlier: the sandbox
    /// still holds its raw token (the row holds only the hash), so nothing is
    /// minted - but the owner's connected servers are listed fresh, so an app
    /// connected since the spawn is advertised on the next attach.
    fn restore(
        &self,
        owner: &MacroUserIdStr<'static>,
        session_token: String,
    ) -> impl Future<Output = Result<SandboxEgress>> + Send;
}

/// Provisions the container transports agent sessions run through.
pub trait ContainerManager: Send + Sync + 'static {
    /// Transport returned by this provider.
    type Transport: AgentConnector;

    /// Boot a new container for a session that has never had one.
    fn spawn(
        &self,
        command: SpawnContainer,
    ) -> impl Future<Output = Result<Self::Transport>> + Send;

    /// How this manager applies a change from `from` to `to`.
    ///
    /// Domain uses this to decide whether to close the session before
    /// [`Self::resize`]. Named size → CPU/RAM mapping is harness policy;
    /// whether a running container can take that change is a manager
    /// capability.
    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect;

    /// Change a live sandbox's compute to `size`.
    ///
    /// Domain has already closed the session when [`Self::resize_effect`]
    /// returned [`SandboxResizeEffect::Restart`]. [`SandboxResizeEffect::InPlace`]
    /// must not stop the sandbox. Disk is never changed.
    fn resize(
        &self,
        session: AgentSessionId,
        size: SandboxSize,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Reattach to a session's existing container, starting it if stopped.
    fn resume(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Self::Transport>> + Send;

    /// The raw egress session token the session's container holds, if this
    /// provider's containers hold one.
    ///
    /// The harness keeps only the token's hash, so on a reattach the running
    /// container is the one place the raw token still exists - it was handed
    /// exactly one, at spawn, in its environment. Providers whose sessions
    /// carry no egress environment (the in-process agent, Cursor's cloud)
    /// answer `None`.
    ///
    /// Only meaningful for a running container; call it after [`Self::resume`].
    fn session_token(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Option<String>>> + Send;

    /// Destroy a session's container for good.
    ///
    /// Unlike the idle reaper, which stops a sandbox so it can be resumed,
    /// this is the end of the session: nothing will reattach. A session with
    /// no container is already in the state this asks for, so it succeeds.
    fn teardown(&self, session: AgentSessionId) -> impl Future<Output = Result<()>> + Send;
}
