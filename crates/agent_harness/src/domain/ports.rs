//! Outbound capabilities required by the harness domain.

use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::model::{AgentSessionId, SandboxSize};
use agent_session::domain::ports::AgentConnector;
use bot_id::BotId;

use macro_user_id::user_id::MacroUserIdStr;

use super::error::Result;
use super::model::{
    PriorChannelMessage, ProvisionedEgress, SandboxEgress, SessionAnnouncement, SpawnContainer,
};
use super::sandbox::SandboxResizeEffect;

#[cfg(test)]
mod test;

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
    ) -> impl Future<Output = Option<RuntimeAttachment<Self::Connector>>> + Send;
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
