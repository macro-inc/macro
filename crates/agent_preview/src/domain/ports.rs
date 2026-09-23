//! Capabilities needed to expose an authenticated preview.
use super::{AgentIdentity, Preview, PreviewError};
use agent_fold::domain::log::AgentSessionId;
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::io::{AsyncRead, AsyncWrite};

/// Duplex byte stream; independent of its SSH transport.
pub trait Duplex: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Duplex for T {}
/// A stream opened through a registered reverse tunnel.
pub type Stream = Box<dyn Duplex>;

/// A registered remote forward, never an arbitrary server-side socket address.
#[async_trait]
pub trait Tunnel: Send + Sync {
    /// Open a new connection to the client-selected destination.
    async fn open(&self) -> Result<Stream, PreviewError>;
    /// Terminate the SSH transport and all its streams.
    async fn close(&self);
}

/// Existing session authentication and entity access, supplied by Macro.
#[async_trait]
pub trait Authority: Send + Sync {
    /// Authenticate an agent's existing session token.
    async fn agent(&self, token: &str) -> Result<AgentIdentity, PreviewError>;
    /// Recheck view access and whether the session is still open.
    async fn viewer(
        &self,
        session: AgentSessionId,
        user: &MacroUserIdStr<'_>,
    ) -> Result<(), PreviewError>;
    /// Whether the originating agent session remains open.
    async fn active(&self, session: AgentSessionId) -> Result<(), PreviewError>;
}

/// Publish preview state changes to the existing connection gateway.
#[async_trait]
pub trait Events: Send + Sync {
    /// Notify subscribed viewers; the read endpoint remains authoritative.
    async fn changed(
        &self,
        preview: &Preview,
        viewers: &[MacroUserIdStr<'static>],
    ) -> Result<(), PreviewError>;
}
