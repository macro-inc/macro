//! The container port: the sandboxes agent sessions run inside.

use std::future::Future;

use agent_session::domain::model::AgentSessionId;

use crate::domain::connector::AgentConnector;
use crate::domain::error::Result;

/// Identifies one sandbox at its provider.
///
/// One per session, so it derives from [`AgentSessionId`] and reattaching needs
/// no stored mapping. Still a separate type: a session id must not reach an API
/// expecting a sandbox id.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContainerId(String);

impl ContainerId {
    /// Name a sandbox.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Borrow the id's string form.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<AgentSessionId> for ContainerId {
    fn from(session: AgentSessionId) -> Self {
        Self(session.to_string())
    }
}

impl std::fmt::Display for ContainerId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// An [`AgentConnector`] that is a sandbox we provisioned.
pub trait Container: AgentConnector {
    /// Which sandbox this is, for reattaching to it later.
    fn container_id(&self) -> &ContainerId;
}

/// Provisions the sandboxes sessions run in.
pub trait ContainerManager: Send + Sync + 'static {
    /// The container connection this manager hands out.
    type Container: Container;

    /// Boot a new sandbox for a session that has never had one.
    fn spawn(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Self::Container>> + Send;

    /// Reattach to the sandbox a session already has, starting it if stopped.
    fn resume(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Self::Container>> + Send;
}
