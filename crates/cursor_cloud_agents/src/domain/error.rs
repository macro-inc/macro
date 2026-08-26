//! Errors the session service can produce.

use agent_client_protocol::schema::v1::SessionId;
use thiserror::Error;

/// Why a session operation failed.
#[derive(Debug, Error)]
pub enum SessionError {
    /// The client referenced a session this agent never created.
    #[error("unknown session {0}")]
    UnknownSession(SessionId),
    /// A prompt arrived while the session's previous turn was still running.
    /// ACP turns are strictly sequential; the client must wait for the
    /// previous `session/prompt` to respond.
    #[error("session {0} already has an active turn")]
    TurnAlreadyActive(SessionId),
    /// The Cursor API or its stream failed.
    #[error("{0}")]
    Cursor(rootcause::Report),
}

impl From<rootcause::Report> for SessionError {
    fn from(report: rootcause::Report) -> Self {
        Self::Cursor(report)
    }
}
