//! Persist the task a session works on.

use super::*;
use crate::domain::session_task::{SessionTaskRepo, TaskDocumentId};

impl<B: BotFacts + 'static> SessionTaskRepo for PgAgentSessionRepo<B> {
    async fn set_task(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<Option<String>> {
        // RETURNING reads the row under this write's lock, so a pull request recorded
        // concurrently is either returned here or recorded after this commits.
        sqlx::query_scalar!(
            r#"
            UPDATE agent_session SET task_id = $3
            WHERE id = $1 AND owner_id = $2
            RETURNING pull_request_url
            "#,
            session.as_uuid(),
            owner.as_ref(),
            task.as_str(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?
        .ok_or(AgentSessionError::Forbidden)
    }

    async fn task(&self, session: AgentSessionId) -> Result<Option<TaskDocumentId>> {
        let task = sqlx::query_scalar!(
            "SELECT task_id FROM agent_session WHERE id = $1",
            session.as_uuid(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(task.map(TaskDocumentId::from_stored))
    }
}
