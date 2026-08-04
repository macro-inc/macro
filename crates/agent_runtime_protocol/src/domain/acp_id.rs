//! The ACP-level session identifier.

use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionId;
use serde::{Deserialize, Serialize};

/// Identifies the ACP session an agent created in `session/new`.
///
/// Chosen by the agent, so it does not exist until the handshake completes.
/// Not interchangeable with `AgentSessionId`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AcpId(Arc<str>);

impl AcpId {
    /// Wrap the session id an agent reported.
    #[must_use]
    pub fn new(id: impl Into<Arc<str>>) -> Self {
        Self(id.into())
    }

    /// Borrow the id's string form.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for AcpId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

impl From<SessionId> for AcpId {
    fn from(id: SessionId) -> Self {
        Self(id.0)
    }
}

impl From<AcpId> for SessionId {
    fn from(id: AcpId) -> Self {
        Self::new(id.0)
    }
}
