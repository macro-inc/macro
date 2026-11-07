use agent_client_protocol::schema::ProtocolVersion;

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;

/// The ACP version spoken by agent sessions.
pub const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion::V1;

/// Physical directory inside the container where the agent works.
pub const MANAGED_CONTAINER_WORKSPACE: &str = "/workspace";

/// In-memory port implementations for tests.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
