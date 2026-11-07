//! Identities of agent sessions and of the harness replicas that manage them.
//!
//! A leaf crate so that crates which only pass these ids around need not
//! depend on `agent_session` or `agent_fold`; both re-export them from their
//! old paths. It must stay wasm-safe: the fold runs in the browser.

use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

/// The identity of an agent session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentSessionId(Uuid);

impl AgentSessionId {
    /// A fixed id for tests.
    #[cfg(any(test, feature = "test-utils"))]
    pub const TEST_A: Self = Self(Uuid::from_u128(0xA));

    /// A second fixed id for tests that need two distinct sessions.
    #[cfg(any(test, feature = "test-utils"))]
    pub const TEST_B: Self = Self(Uuid::from_u128(0xB));

    /// Mint a fresh session id, backed by a UUIDv7.
    #[expect(clippy::new_without_default, reason = "each call mints a distinct id")]
    #[must_use]
    pub fn new() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// Wrap an existing UUID as an agent session id.
    #[must_use]
    pub fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The underlying UUID.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

/// A string that does not name an agent session.
#[derive(Debug, thiserror::Error)]
#[error("invalid agent session id")]
pub struct InvalidAgentSessionId;

impl std::str::FromStr for AgentSessionId {
    type Err = InvalidAgentSessionId;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        value
            .parse::<Uuid>()
            .map(Self)
            .map_err(|_| InvalidAgentSessionId)
    }
}

impl std::fmt::Display for AgentSessionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

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

/// A session's takeover counter, bumped by every successful claim.
///
/// Carried by the claim holder into each live-actor write; the store rejects
/// writes whose fence has been superseded, so a stale holder is neutralized
/// by the same statement that would have written (a fencing token).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ManagerFence(pub i64);
