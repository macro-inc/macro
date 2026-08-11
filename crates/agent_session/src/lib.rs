use agent_client_protocol::schema::ProtocolVersion;

pub mod domain;
pub mod inbound;
pub mod outbound;
pub mod wire;

/// The ACP version spoken by agent sessions.
pub const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion::V1;

/// Physical directory inside the container where the agent works.
pub const AGENT_WORKING_DIRECTORY: &str = "/workspace";

/// In-memory port implementations for tests.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
