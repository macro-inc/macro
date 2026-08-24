//! Outbound capabilities required by the harness domain.

use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::model::{AgentSessionId, SandboxSize};
use agent_session::domain::ports::AgentConnector;
use bot_id::BotId;

use super::error::Result;
use super::model::{SessionAnnouncement, SpawnContainer};
use super::sandbox::SandboxResizeEffect;

#[cfg(test)]
mod test;

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

    /// Destroy a session's container for good.
    ///
    /// Unlike the idle reaper, which stops a sandbox so it can be resumed,
    /// this is the end of the session: nothing will reattach. A session with
    /// no container is already in the state this asks for, so it succeeds.
    fn teardown(&self, session: AgentSessionId) -> impl Future<Output = Result<()>> + Send;
}
