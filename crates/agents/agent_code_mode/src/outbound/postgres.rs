//! Durable execution records scoped by session; deleting the session cascades.
use crate::domain::{CodeModeError, ExecutionId, ExecutionRecord, ExecutionStore};
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use sqlx::{PgPool, types::Json};

/// PostgreSQL implementation of the execution journal.
pub struct PgExecutionStore(PgPool);

impl PgExecutionStore {
    /// Use the application's MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self(pool)
    }
}

fn storage(error: sqlx::Error) -> CodeModeError {
    CodeModeError::Storage(rootcause::report!(error).into())
}

#[async_trait]
impl ExecutionStore for PgExecutionStore {
    async fn create(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        sqlx::query!(
            "INSERT INTO agent_code_execution (id, agent_session_id, record) VALUES ($1, $2, $3)",
            record.execution_id.as_uuid(),
            session.as_uuid(),
            Json(record) as _,
        )
        .execute(&self.0)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|error| error.is_unique_violation())
            {
                CodeModeError::Duplicate
            } else {
                storage(error)
            }
        })?;
        Ok(())
    }

    async fn save(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        let result = sqlx::query!(
            "UPDATE agent_code_execution SET record = $3 WHERE id = $1 AND agent_session_id = $2 AND record->>'status' = 'running'",
            record.execution_id.as_uuid(),
            session.as_uuid(),
            Json(record) as _,
        )
        .execute(&self.0)
        .await
        .map_err(storage)?;
        if result.rows_affected() != 1 {
            return Err(CodeModeError::NotFound);
        }
        Ok(())
    }

    async fn get(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        sqlx::query_scalar!(
            r#"SELECT record AS "record: Json<ExecutionRecord>" FROM agent_code_execution WHERE id = $1 AND agent_session_id = $2"#,
            execution.as_uuid(), session.as_uuid(),
        ).fetch_optional(&self.0).await.map_err(storage)?.map(|record| record.0).ok_or(CodeModeError::NotFound)
    }
}

#[cfg(test)]
mod test;
