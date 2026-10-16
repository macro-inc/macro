//! Persist the task a session works on.

use super::*;
use crate::domain::session_task::{SessionTaskRepo, SessionTaskWrite, TaskDocumentId};

impl<B: BotFacts + 'static> SessionTaskRepo for PgAgentSessionRepo<B> {
    async fn set_task(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<SessionTaskWrite> {
        // The subquery locks the row before reading the previous task, and RETURNING reads
        // under this write's lock, so a pull request recorded concurrently is either returned
        // here or recorded after this commits.
        let row = sqlx::query!(
            r#"
            UPDATE agent_session AS session SET task_id = $3
            FROM (
                SELECT id, task_id FROM agent_session WHERE id = $1 AND owner_id = $2 FOR UPDATE
            ) AS previous
            WHERE session.id = previous.id
            RETURNING
                session.pull_request_url,
                previous.task_id IS DISTINCT FROM $3 AS "changed!"
            "#,
            session.as_uuid(),
            owner.as_ref(),
            task.as_str(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?
        .ok_or(AgentSessionError::Forbidden)?;
        Ok(SessionTaskWrite {
            changed: row.changed,
            pull_request_url: row.pull_request_url,
        })
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
