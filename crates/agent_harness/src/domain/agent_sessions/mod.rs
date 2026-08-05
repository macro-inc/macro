use agent_client_protocol::schema::ProtocolVersion;

mod manager;
mod session;

pub use manager::AgentSessionManager;
#[cfg(test)]
pub use session::SessionStatus;

#[cfg(test)]
mod tests;

/// Working directory every ACP session is created in. Must match
/// `container/ensure_ready.sh`, which a test asserts.
pub(crate) const WORKSPACE: &str = "/workspace";

/// The ACP version we speak.
pub(crate) const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion::V1;
