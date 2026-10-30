//! Which ACP sessions a runtime still serves when it dials in again.
//!
//! A runtime can keep agents running while its connection to the service
//! drops: macrod's native Herdr agents outlive both the socket and the ACP
//! process that drove them. The service binds sessions lazily, so after a
//! redial nothing would load those sessions until someone sent a control.
//! The service asks this once per connection and reattaches the answer.
use agent_client_protocol::schema::v1::SessionId;
use serde::{Deserialize, Serialize};

/// ACP extension request the service sends on a new runtime connection.
///
/// Connection-level: it names no session and needs no `initialize`. Agents
/// that do not implement it answer method-not-found, which means "none".
pub const LIVE_SESSIONS_METHOD: &str = "_macro/live_sessions";

/// The answer to [`LIVE_SESSIONS_METHOD`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionsResponse {
    /// ACP sessions whose agent is still running and should be loaded.
    pub session_ids: Vec<SessionId>,
}
