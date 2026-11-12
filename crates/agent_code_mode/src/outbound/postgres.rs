//! Durable execution records scoped by session; deleting the session cascades.
use crate::domain::{CodeModeError, ExecutionId, ExecutionRecord, ExecutionStore};
use agent_session::domain::model::AgentSessionId;
use async_trait::async_trait;
use serde_json::Value;
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

/// The record as JSONB accepts it. PostgreSQL rejects `\u0000` in JSONB text,
/// which program sources, results and tool outputs can contain.
fn jsonb(record: &ExecutionRecord) -> Result<Value, CodeModeError> {
    let mut value = serde_json::to_value(record)
        .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))?;
    strip_nul(&mut value);
    Ok(value)
}

fn strip_nul(value: &mut Value) {
    match value {
        Value::String(text) if text.contains('\0') => *text = text.replace('\0', ""),
        Value::Array(items) => items.iter_mut().for_each(strip_nul),
        Value::Object(fields) => {
            if fields.keys().any(|key| key.contains('\0')) {
                *fields = std::mem::take(fields)
                    .into_iter()
                    .map(|(key, value)| (key.replace('\0', ""), value))
                    .collect();
            }
            fields.values_mut().for_each(strip_nul);
        }
        _ => {}
    }
}

#[async_trait]
impl ExecutionStore for PgExecutionStore {
    async fn create(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        let record_json = jsonb(record)?;
        sqlx::query!(
            "INSERT INTO agent_code_execution (id, agent_session_id, record) VALUES ($1, $2, $3)",
            record.execution_id.as_uuid(),
            session.as_uuid(),
            Json(record_json) as _,
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
        let record_json = jsonb(record)?;
        let result = sqlx::query!(
            "UPDATE agent_code_execution SET record = $3 WHERE id = $1 AND agent_session_id = $2 AND record->>'status' = 'running'",
            record.execution_id.as_uuid(),
            session.as_uuid(),
            Json(record_json) as _,
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
