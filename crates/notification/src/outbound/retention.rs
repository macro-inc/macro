//! PostgreSQL retention adapter. Only parent notifications are deleted: foreign
//! keys remove recipients/receipts and the existing trigger emits delete events.

use std::num::NonZeroU16;

use chrono::{DateTime, NaiveDateTime, Utc};
use rootcause::Report;
use sqlx::PgPool;

use crate::domain::retention::{NotificationRetentionRepository, RetentionBatch, RetentionPreview};

// Transaction-scoped, so a pooled connection can never retain the lock after
// this operation. The key is local to notification retention ("notifret").
const RETENTION_LOCK: i64 = 0x6e6f_7469_6672_6574;

/// An indexed, bounded retention repository using short transactions.
pub struct PgNotificationRetentionRepository {
    pool: PgPool,
}

impl PgNotificationRetentionRepository {
    /// Construct over a maintenance pool with a short acquisition timeout.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl NotificationRetentionRepository for PgNotificationRetentionRepository {
    async fn current_time(&self) -> Result<DateTime<Utc>, Report> {
        Ok(sqlx::query_scalar!(r#"SELECT clock_timestamp() AS "now!""#)
            .fetch_one(&self.pool)
            .await?)
    }

    async fn preview(
        &self,
        cutoff: NaiveDateTime,
        limit: NonZeroU16,
    ) -> Result<RetentionPreview, Report> {
        let row = sqlx::query!(
            r#"
            SELECT count(*) AS "count!", min(created_at) AS oldest
            FROM (
                SELECT created_at FROM notification
                WHERE created_at < $1
                ORDER BY created_at, id
                LIMIT $2
            ) expired
            "#,
            cutoff,
            i64::from(limit.get()),
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(RetentionPreview {
            sampled_expired: row.count as u64,
            oldest_expired_at: row.oldest,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_batch(
        &self,
        cutoff: NaiveDateTime,
        limit: NonZeroU16,
    ) -> Result<RetentionBatch, Report> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        sqlx::query!("SET LOCAL lock_timeout = '1s'")
            .execute(&mut *tx)
            .await?;
        let acquired = sqlx::query_scalar!(
            r#"SELECT pg_try_advisory_xact_lock($1) AS "acquired!""#,
            RETENTION_LOCK,
        )
        .fetch_one(&mut *tx)
        .await?;
        if !acquired {
            tx.rollback().await?;
            return Ok(RetentionBatch::Busy);
        }

        let result = sqlx::query!(
            r#"
            WITH expired AS (
                SELECT id FROM notification
                WHERE created_at < $1
                ORDER BY created_at, id
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            DELETE FROM notification n
            USING expired e
            WHERE n.id = e.id
            "#,
            cutoff,
            i64::from(limit.get()),
        )
        .execute(&mut *tx)
        .await;
        match result {
            Ok(result) => {
                tx.commit().await?;
                Ok(RetentionBatch::Deleted(result.rows_affected()))
            }
            Err(error) => {
                tx.rollback().await?;
                // A timeout may mean one parent fans out to too many children.
                // The service retries a smaller batch; unrelated errors fail
                // the invocation and surface through the Lambda error alarm.
                match error.as_database_error().and_then(|e| e.code()).as_deref() {
                    Some("57014" | "55P03") => Ok(RetentionBatch::TimedOut),
                    _ => Err(error.into()),
                }
            }
        }
    }
}

#[cfg(test)]
mod test;
