use super::PgRemindersRepo;
use crate::domain::{
    email_followup::{EmailFollowupCommand, EmailFollowupRepo, FollowupRecord, FollowupState},
    models::ReminderError,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Postgres, Transaction, types::Json};
use std::time::Duration;
use uuid::Uuid;

const LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const LOCK_INITIAL_BACKOFF: Duration = Duration::from_millis(10);
const LOCK_MAX_BACKOFF: Duration = Duration::from_millis(100);

fn db(error: sqlx::Error) -> ReminderError {
    ReminderError::Internal(rootcause::Report::new(error).into_dynamic())
}

impl EmailFollowupRepo for PgRemindersRepo {
    type Guard = Transaction<'static, Postgres>;

    async fn lock_followup(
        &self,
        user: &MacroUserIdStr<'_>,
        thread: Uuid,
    ) -> Result<Self::Guard, ReminderError> {
        // The transaction exists only to hold the lock. Durable intent writes
        // use their own transactions, so dropping/crashing this guard cannot
        // roll back intent after an email side effect has committed.
        let key = format!("{}:{thread}", user.as_ref());
        tokio::time::timeout(LOCK_WAIT_TIMEOUT, async {
            let mut backoff = LOCK_INITIAL_BACKOFF;
            loop {
                let mut guard = self.followup_locks.begin().await.map_err(db)?;
                // The guard is deliberately idle during email/notification I/O.
                // A deployment's idle transaction timeout must not release it.
                sqlx::query!("SET LOCAL idle_in_transaction_session_timeout = 0")
                    .execute(&mut *guard)
                    .await
                    .map_err(db)?;
                let locked = sqlx::query_scalar!(
                    r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 732849)) AS "locked!""#,
                    key
                )
                .fetch_one(&mut *guard)
                .await
                .map_err(db)?;
                if locked {
                    return Ok(guard);
                }
                // Finish rollback before sleeping, returning the connection to
                // the pool so unrelated threads can acquire their own locks.
                guard.rollback().await.map_err(db)?;
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(LOCK_MAX_BACKOFF);
            }
        })
        .await
        .map_err(|_| db(sqlx::Error::PoolTimedOut))?
    }

    async fn thread_followup(
        &self,
        user: &MacroUserIdStr<'_>,
        thread: Uuid,
    ) -> Result<Option<FollowupRecord>, ReminderError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT payload AS "payload!: Json<FollowupRecord>" FROM reminder_email_followup
               WHERE user_id = $1 AND thread_id = $2 ORDER BY created_at DESC, reminder_id DESC LIMIT 1"#,
            user.as_ref(), thread,
        ).fetch_optional(&self.pool).await.map_err(db)?.map(|record| record.0))
    }

    async fn reminder_followup(
        &self,
        user: &MacroUserIdStr<'_>,
        reminder: Uuid,
    ) -> Result<Option<FollowupRecord>, ReminderError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT payload AS "payload!: Json<FollowupRecord>" FROM reminder_email_followup
               WHERE user_id = $1 AND reminder_id = $2"#,
            user.as_ref(),
            reminder,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?
        .map(|record| record.0))
    }

    async fn previous_operation(
        &self,
        user: &MacroUserIdStr<'_>,
        operation: Uuid,
    ) -> Result<Option<(Uuid, EmailFollowupCommand)>, ReminderError> {
        Ok(sqlx::query!(
            r#"SELECT reminder_id, request AS "request!: Json<EmailFollowupCommand>" FROM reminder_email_operation
               WHERE user_id = $1 AND operation_id = $2"#,
            user.as_ref(), operation,
        ).fetch_optional(&self.pool).await.map_err(db)?.map(|row| (row.reminder_id, row.request.0)))
    }

    async fn save_followup(
        &self,
        record: &FollowupRecord,
        command: Option<&EmailFollowupCommand>,
        description: Option<&str>,
    ) -> Result<(), ReminderError> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let f = &record.followup;
        let enabled = matches!(f.state, FollowupState::Pending | FollowupState::Returned);
        let completed = matches!(f.state, FollowupState::Cancelled | FollowupState::Removed);
        let payload = Json(record);
        sqlx::query!(
            r#"INSERT INTO reminder (id, user_id, description, entity_type, entity_id, remind_at, next_run_at, enabled, completed_at)
               VALUES ($1, $2, COALESCE($3, 'Email follow-up'), 'email_thread', $4, $5, $5, $6, CASE WHEN $7 THEN now() END)
               ON CONFLICT (id) DO UPDATE SET remind_at = EXCLUDED.remind_at, next_run_at = EXCLUDED.next_run_at,
                   enabled = EXCLUDED.enabled, completed_at = EXCLUDED.completed_at, updated_at = now()
               WHERE reminder.user_id = EXCLUDED.user_id"#,
            f.reminder_id, record.user_id.as_ref(), description, f.thread_id, f.remind_at, enabled, completed,
        ).execute(&mut *tx).await.map_err(db)?;
        sqlx::query!(
            r#"INSERT INTO reminder_email_followup (reminder_id, user_id, thread_id, link_id, state, payload)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (reminder_id) DO UPDATE SET state = EXCLUDED.state, payload = EXCLUDED.payload
               WHERE reminder_email_followup.user_id = EXCLUDED.user_id"#,
            f.reminder_id, record.user_id.as_ref(), f.thread_id, f.link_id, f.state.as_str(), payload as _,
        ).execute(&mut *tx).await.map_err(db)?;
        if let Some(command) = command {
            let accepted = sqlx::query!(
                r#"INSERT INTO reminder_email_operation (user_id, operation_id, thread_id, request, reminder_id)
                   VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, operation_id) DO NOTHING"#,
                record.user_id.as_ref(), command.operation_id(), f.thread_id, Json(command) as _, f.reminder_id,
            ).execute(&mut *tx).await.map_err(db)?;
            if accepted.rows_affected() != 1 {
                return Err(ReminderError::BadRequest(
                    "This request identity was already used for another email operation".into(),
                ));
            }
        }
        if !enabled {
            // Remove only this snooze's notification on the original email thread.
            sqlx::query!(
                r#"DELETE FROM notification WHERE event_item_type = 'email_thread' AND event_item_id = $2
                       AND notification_event_type = 'reminder' AND metadata->>'reminderId' = $1"#,
                f.reminder_id.to_string(),
                f.thread_id.to_string(),
            ).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)
    }

    async fn reconciliation_page(
        &self,
        after: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<FollowupRecord>, ReminderError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT payload AS "payload!: Json<FollowupRecord>" FROM reminder_email_followup
               WHERE state IN ('archiving', 'pending', 'returning') AND ($1::uuid IS NULL OR reminder_id > $1)
               ORDER BY reminder_id LIMIT $2"#,
            after, limit,
        ).fetch_all(&self.pool).await.map_err(db)?.into_iter().map(|record| record.0).collect())
    }
}

#[cfg(test)]
mod test;
