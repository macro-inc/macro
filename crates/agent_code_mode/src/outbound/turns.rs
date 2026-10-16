//! Shared turn facts from the owning session domain.
use crate::domain::{CodeModeError, ExecutionTurns};
use agent_session::domain::{model::AgentSessionId, ports::ActiveSessionTurn};
use async_trait::async_trait;
use macro_uuid::Uuid;

/// Adapts the session's durable turn capability without querying its tables.
pub struct SessionTurns<R>(pub R);

#[async_trait]
impl<R: ActiveSessionTurn> ExecutionTurns for SessionTurns<R> {
    async fn active(&self, session: AgentSessionId) -> Result<Option<Uuid>, CodeModeError> {
        self.0
            .active_turn(session)
            .await
            .map(|turn| turn.map(|id| id.as_uuid()))
            .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))
    }
}
