//! Session-scoped review persistence with optimistic revision checks.
use crate::domain::{CodeModeError, ExecutionId, reviews::*};
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use sqlx::{PgPool, types::Json};

#[cfg(test)]
mod test;

/// PostgreSQL reviews; session and execution deletion cascade normally.
pub struct PgReviewStore(pub PgPool);
fn storage(error: sqlx::Error) -> CodeModeError {
    CodeModeError::Storage(rootcause::report!(error).into())
}
#[async_trait]
impl ReviewStore for PgReviewStore {
    async fn create(
        &self,
        record: &ReviewRecord,
        max_per_session: u16,
    ) -> Result<(), CodeModeError> {
        let mut transaction = self.0.begin().await.map_err(storage)?;
        // All creators lock the same session row, whether or not a code execution
        // originated the review. This bounds direct and SDK review creation alike.
        sqlx::query_scalar!(
            "SELECT id FROM agent_session WHERE id = $1 FOR UPDATE",
            record.session_id.as_uuid()
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(storage)?
        .ok_or(CodeModeError::NotFound)?;
        let count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM agent_session_review WHERE agent_session_id = $1",
            record.session_id.as_uuid()
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?
        .unwrap_or_default();
        if count >= i64::from(max_per_session) {
            return Err(CodeModeError::Invalid(
                "The session's review stack limit was reached.".into(),
            ));
        }
        sqlx::query!("INSERT INTO agent_session_review (id, agent_session_id, execution_id, revision, record) VALUES ($1, $2, $3, $4, $5)", record.id.0, record.session_id.as_uuid(), record.execution_id.map(ExecutionId::as_uuid), record.revision, Json(record) as _).execute(&mut *transaction).await.map_err(storage)?;
        transaction.commit().await.map_err(storage)?;
        Ok(())
    }
    async fn get(
        &self,
        session: AgentSessionId,
        id: ReviewId,
    ) -> Result<ReviewRecord, CodeModeError> {
        sqlx::query_scalar!(r#"SELECT record AS "record: Json<ReviewRecord>" FROM agent_session_review WHERE id = $1 AND agent_session_id = $2"#, id.0, session.as_uuid()).fetch_optional(&self.0).await.map_err(storage)?.map(|record| record.0).ok_or(CodeModeError::NotFound)
    }
    async fn list(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<Vec<ReviewRecord>, CodeModeError> {
        Ok(sqlx::query_scalar!(r#"SELECT record AS "record: Json<ReviewRecord>" FROM agent_session_review WHERE agent_session_id = $1 AND execution_id = $2 ORDER BY id LIMIT 100"#, session.as_uuid(), execution.as_uuid()).fetch_all(&self.0).await.map_err(storage)?.into_iter().map(|record| record.0).collect())
    }
    async fn save(&self, expected: i64, record: &ReviewRecord) -> Result<(), CodeModeError> {
        let result = sqlx::query!("UPDATE agent_session_review SET record = $4, revision = $5 WHERE id = $1 AND agent_session_id = $2 AND revision = $3", record.id.0, record.session_id.as_uuid(), expected, Json(record) as _, record.revision).execute(&self.0).await.map_err(storage)?;
        if result.rows_affected() != 1 {
            return Err(CodeModeError::Conflict);
        }
        Ok(())
    }
}
