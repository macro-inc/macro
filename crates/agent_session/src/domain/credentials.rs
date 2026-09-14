//! Resolve a session credential independently of the operations it authorizes.

use super::{
    error::{AgentSessionError, Result},
    model::{AgentSession, SessionStatus},
    ports::AgentSessionRepo,
};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;

/// Authenticate the digest of a presented credential against an active session.
/// Repository and tool-specific policy belongs to the operation using the session.
pub async fn authenticate_session<R: AgentSessionRepo>(
    repo: &R,
    token_hash: &str,
) -> Result<AgentSession> {
    let session = repo
        .find_by_egress_token_hash(token_hash)
        .await?
        .ok_or(AgentSessionError::Forbidden)?;
    if matches!(
        session.status,
        SessionStatus::Disconnected | SessionStatus::Event(SystemEvent::Disconnected)
    ) {
        return Err(AgentSessionError::Disconnected(session.id));
    }
    Ok(session)
}
