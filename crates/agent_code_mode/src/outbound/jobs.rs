//! Background job rows: execution records with the job columns that cap,
//! cancel, settle and sweep them.
use crate::domain::{
    CodeModeError, ExecutionId, ExecutionRecord, JobCancel, JobCaps, JobControl, JobStore,
};
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::notifications::{NotificationWriter, PendingNotification};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgConnection, PgPool, types::Json};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// PostgreSQL job rows in `agent_code_execution`, with the session outbox
/// written in the transaction that settles a job.
pub struct PgJobStore {
    pool: PgPool,
    notifications: Arc<dyn NotificationWriter<PgConnection>>,
}

impl PgJobStore {
    /// Use the application's MacroDB pool and the session outbox.
    pub fn new(pool: PgPool, notifications: Arc<dyn NotificationWriter<PgConnection>>) -> Self {
        Self {
            pool,
            notifications,
        }
    }
}

fn storage(error: sqlx::Error) -> CodeModeError {
    CodeModeError::Storage(rootcause::report!(error).into())
}

fn jsonb(record: &ExecutionRecord) -> Result<serde_json::Value, CodeModeError> {
    super::postgres::jsonb(record)
}

#[async_trait]
impl JobStore for PgJobStore {
    async fn launch(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        record: &ExecutionRecord,
        caps: JobCaps,
    ) -> Result<(), CodeModeError> {
        let deadline = record
            .job
            .as_ref()
            .map(|job| job.deadline)
            .ok_or_else(|| CodeModeError::Invalid("a job needs a deadline".into()))?;
        let record_json = jsonb(record)?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        // One launch at a time per account, so two at once cannot both pass
        // the caps. The session's jobs belong to its owner's account.
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended('agent_code_execution_jobs:' || $1, 0))",
            owner.as_ref(),
        )
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        let running = sqlx::query!(
            r#"SELECT
                COUNT(*) FILTER (WHERE agent_session_id = $1) AS "session!",
                COUNT(*) AS "account!"
            FROM agent_code_execution
            WHERE job_deadline IS NOT NULL AND job_settled_at IS NULL AND job_owner_id = $2"#,
            session.as_uuid(),
            owner.as_ref(),
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(storage)?;
        if running.session >= i64::from(caps.per_session) {
            return Err(CodeModeError::JobLimit(format!(
                "{} background jobs already run in this session; wait for one to finish or cancel one with CancelJob. This program did not run.",
                caps.per_session
            )));
        }
        if running.account >= i64::from(caps.per_account) {
            return Err(CodeModeError::JobLimit(format!(
                "{} background jobs already run across this account's sessions; wait for one to finish. This program did not run.",
                caps.per_account
            )));
        }
        sqlx::query!(
            "INSERT INTO agent_code_execution (id, agent_session_id, record, job_owner_id, job_deadline) VALUES ($1, $2, $3, $4, $5)",
            record.execution_id.as_uuid(),
            session.as_uuid(),
            Json(record_json) as _,
            owner.as_ref(),
            deadline,
        )
        .execute(&mut *transaction)
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
        transaction.commit().await.map_err(storage)
    }

    async fn save_activity(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        let record_json = jsonb(record)?;
        let result = sqlx::query!(
            "UPDATE agent_code_execution SET record = $3 WHERE id = $1 AND agent_session_id = $2 AND job_deadline IS NOT NULL AND job_settled_at IS NULL",
            record.execution_id.as_uuid(),
            session.as_uuid(),
            Json(record_json) as _,
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        if result.rows_affected() != 1 {
            return Err(CodeModeError::NotFound);
        }
        Ok(())
    }

    async fn control(
        &self,
        session: AgentSessionId,
        job: ExecutionId,
    ) -> Result<JobControl, CodeModeError> {
        let row = sqlx::query!(
            // `is_job` is a column, not a filter: as a filter it matches the
            // session's partial job index, whose generic plan reads every job
            // the session ever ran instead of the primary key.
            r#"SELECT job_cancel_requested_at, job_settled_at, job_deadline IS NOT NULL AS "is_job!"
            FROM agent_code_execution WHERE id = $1 AND agent_session_id = $2"#,
            job.as_uuid(),
            session.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        Ok(match row {
            None => JobControl::Gone,
            Some(row) if !row.is_job => JobControl::Gone,
            Some(row) if row.job_settled_at.is_some() => JobControl::Settled,
            Some(row) if row.job_cancel_requested_at.is_some() => JobControl::CancelRequested,
            Some(_) => JobControl::Running,
        })
    }

    async fn request_cancel(
        &self,
        session: AgentSessionId,
        job: ExecutionId,
    ) -> Result<JobCancel, CodeModeError> {
        // A foreground execution's row is left as it was (the CASE), and
        // `job_deadline` is not a filter, for the reason given in `control`.
        let row = sqlx::query!(
            r#"UPDATE agent_code_execution
            SET job_cancel_requested_at = CASE WHEN job_deadline IS NULL THEN job_cancel_requested_at
                ELSE COALESCE(job_cancel_requested_at, now()) END
            WHERE id = $1 AND agent_session_id = $2
            RETURNING job_deadline IS NOT NULL AS "is_job!", job_settled_at IS NOT NULL AS "settled!""#,
            job.as_uuid(),
            session.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?
        .filter(|row| row.is_job)
        .ok_or(CodeModeError::NotFound)?;
        Ok(if row.settled {
            JobCancel::AlreadySettled
        } else {
            JobCancel::Requested
        })
    }

    async fn settle(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
        notification: Option<&PendingNotification>,
    ) -> Result<bool, CodeModeError> {
        let record_json = jsonb(record)?;
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let result = sqlx::query!(
            "UPDATE agent_code_execution SET record = $3, job_settled_at = now() WHERE id = $1 AND agent_session_id = $2 AND job_deadline IS NOT NULL AND job_settled_at IS NULL",
            record.execution_id.as_uuid(),
            session.as_uuid(),
            Json(record_json) as _,
        )
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        if result.rows_affected() != 1 {
            return Ok(false);
        }
        if let Some(notification) = notification {
            // The event carries the result and error too, into JSONB.
            let notification = &storable(notification);
            self.notifications
                .produce(&mut *transaction, notification)
                .await
                .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))?;
        }
        transaction.commit().await.map_err(storage)?;
        Ok(true)
    }

    async fn overdue(
        &self,
        before: chrono::DateTime<chrono::Utc>,
        limit: u16,
    ) -> Result<Vec<(AgentSessionId, ExecutionRecord)>, CodeModeError> {
        Ok(sqlx::query!(
            r#"SELECT agent_session_id, record AS "record: Json<ExecutionRecord>"
            FROM agent_code_execution
            WHERE job_deadline IS NOT NULL AND job_settled_at IS NULL AND job_deadline < $1
            ORDER BY job_deadline
            LIMIT $2"#,
            before,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?
        .into_iter()
        .map(|row| {
            (
                AgentSessionId::new_from_uuid(row.agent_session_id),
                row.record.0,
            )
        })
        .collect())
    }

    async fn list(
        &self,
        session: AgentSessionId,
        settled_since: chrono::DateTime<chrono::Utc>,
        limit: u16,
    ) -> Result<Vec<ExecutionRecord>, CodeModeError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT record AS "record: Json<ExecutionRecord>"
            FROM agent_code_execution
            WHERE agent_session_id = $1 AND job_deadline IS NOT NULL
                AND (job_settled_at IS NULL OR job_settled_at >= $2)
            ORDER BY job_settled_at IS NULL DESC, job_deadline DESC
            LIMIT $3"#,
            session.as_uuid(),
            settled_since,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?
        .into_iter()
        .map(|record| record.0)
        .collect())
    }
}

/// A `job.settled` event JSONB can store: without `\u0000`, as [`jsonb`]
/// leaves the record.
fn storable(notification: &PendingNotification) -> PendingNotification {
    let mut notification = notification.clone();
    if let agent_runtime_protocol::domain::notification::NotificationEvent::JobSettled(settlement) =
        &mut notification.notification.event
    {
        if let Some(result) = settlement.result.as_mut() {
            super::postgres::strip_nul(result);
        }
        if let Some(error) = settlement.error.as_mut() {
            error.retain(|character| character != '\0');
        }
        settlement.title.retain(|character| character != '\0');
    }
    notification
}
