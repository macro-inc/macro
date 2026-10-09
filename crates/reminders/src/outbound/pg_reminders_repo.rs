//! PostgreSQL storage for email snoozes and delivery claims.

mod email_collection;
mod email_followup;
#[cfg(test)]
mod test;

use crate::domain::models::{DueFiring, DueReminder};
use crate::domain::ports::{ReminderDispatchRepo, RemindersRepo};
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

/// Postgres-backed reminders repository.
#[derive(Debug, Clone)]
pub struct PgRemindersRepo {
    pool: PgPool,
    followup_locks: PgPool,
}

impl PgRemindersRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self::with_followup_lock_capacity(pool, 4)
    }

    /// Create a repository with a separate connection budget for concurrent
    /// follow-up operations. HTTP and dispatch users should share this instance.
    /// `lock_capacity` must be greater than zero.
    pub fn with_followup_lock_capacity(pool: PgPool, lock_capacity: u32) -> Self {
        // Lock holders span email operations. Keep their connections separate
        // from the data pool; unsuccessful lock attempts release their connection
        // before backoff so waiters do not occupy this pool either.
        let followup_locks = sqlx::postgres::PgPoolOptions::new()
            .max_connections(lock_capacity)
            .connect_lazy_with(pool.connect_options().as_ref().clone());
        Self {
            pool,
            followup_locks,
        }
    }
}

/// Errors produced by email reminder storage.
#[derive(Debug, thiserror::Error)]
pub enum RemindersRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored owner is not a parseable Macro user id.
    #[error("invalid user id stored for reminder {reminder_id}")]
    InvalidUserId {
        /// Snooze carrying the invalid owner.
        reminder_id: Uuid,
    },
}

impl RemindersRepo for PgRemindersRepo {
    type Err = RemindersRepoErr;

    async fn email_candidates(
        &self,
        user: &MacroUserIdStr<'_>,
        thread_ids: Option<&[Uuid]>,
        cursor: Option<crate::domain::email_collection::EmailReminderCursor>,
        as_of: DateTime<Utc>,
        limit: u32,
    ) -> Result<Vec<crate::domain::email_collection::EmailReminderCandidate>, Self::Err> {
        self.read_email_candidates(user, thread_ids, cursor, as_of, limit)
            .await
    }
}

impl ReminderDispatchRepo for PgRemindersRepo {
    type Err = RemindersRepoErr;

    #[tracing::instrument(err, skip(self))]
    async fn due_firings(&self, now: DateTime<Utc>) -> Result<Vec<DueFiring>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT r.id, r.next_run_at
            FROM reminder r
            JOIN reminder_email_followup f ON f.reminder_id = r.id
            WHERE r.enabled AND r.completed_at IS NULL
              AND r.next_run_at <= $1
              AND NOT EXISTS (
                  SELECT 1 FROM reminder_occurrence o
                  WHERE o.reminder_id = r.id AND o.scheduled_for = r.next_run_at
                    AND o.sent_at IS NOT NULL
              )
            ORDER BY r.next_run_at
            "#,
            now,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| DueFiring {
                reminder_id: row.id,
                scheduled_for: row.next_run_at,
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn find_due_reminder(&self, firing: DueFiring) -> Result<Option<DueReminder>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT r.id, r.user_id, r.description, f.thread_id, r.next_run_at
            FROM reminder r
            JOIN reminder_email_followup f ON f.reminder_id = r.id AND f.user_id = r.user_id
            WHERE r.id = $1 AND r.next_run_at = $2
              AND r.enabled AND r.completed_at IS NULL
            "#,
            firing.reminder_id,
            firing.scheduled_for,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(DueReminder {
                reminder_id: row.id,
                thread_id: row.thread_id,
                description: row.description,
                owner_id: MacroUserIdStr::parse_from_str(&row.user_id)
                    .map_err(|_| RemindersRepoErr::InvalidUserId {
                        reminder_id: row.id,
                    })?
                    .into_owned(),
                scheduled_for: row.next_run_at,
            })
        })
        .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    async fn claim_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
        retry_before: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let id = macro_uuid::generate_uuid_v7();

        // One statement covers both a first claim and a retry. The unique index
        // on (reminder_id, scheduled_for) makes the insert the claim; the
        // conflict branch takes over a claim that was made before
        // `retry_before` and never delivered, so a dispatcher that died
        // mid-flight does not strand the firing. A claim that is either already
        // sent or still fresh matches neither and returns no row.
        let claimed = sqlx::query_scalar!(
            r#"
            INSERT INTO reminder_occurrence (id, reminder_id, scheduled_for)
            VALUES ($1, $2, $3)
            ON CONFLICT (reminder_id, scheduled_for) DO UPDATE
               SET created_at = now()
             WHERE reminder_occurrence.sent_at IS NULL
               AND reminder_occurrence.created_at < $4
            RETURNING id
            "#,
            id,
            reminder_id,
            scheduled_for,
            retry_before,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(claimed.is_some())
    }

    #[tracing::instrument(err, skip(self))]
    async fn release_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        // `sent_at IS NULL` guards against releasing a firing that did go out:
        // completion and release can only race if the same firing is being
        // handled twice, and the delivered one must win.
        sqlx::query!(
            r#"
            DELETE FROM reminder_occurrence
            WHERE reminder_id = $1
              AND scheduled_for = $2
              AND sent_at IS NULL
            "#,
            reminder_id,
            scheduled_for,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn complete_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE reminder_occurrence SET sent_at = now()
               WHERE reminder_id = $1 AND scheduled_for = $2"#,
            reminder_id,
            scheduled_for,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
