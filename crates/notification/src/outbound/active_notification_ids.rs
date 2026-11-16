//! Postgres reads of a user's active notification ids by event type.

use crate::domain::active_notification_ids::ActiveNotificationIdRepository;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

/// Adapter for the active notification id read over `user_notification`.
#[derive(Clone)]
pub struct PgActiveNotificationIdRepository(pub PgPool);

impl ActiveNotificationIdRepository for PgActiveNotificationIdRepository {
    async fn active_notification_ids(
        &self,
        user: MacroUserIdStr<'_>,
        event_types: &[String],
        limit: u32,
    ) -> Result<Vec<Uuid>, Report> {
        // No index leads with the event type, so a rare type walks the user's
        // live notifications newest first until the limit fills; bound it.
        let mut transaction = self.0.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let ids = sqlx::query_scalar!(
            r#"
            SELECT notification_id
            FROM user_notification
            WHERE user_id = $1
              AND deleted_at IS NULL
              AND state <> 'done'
              AND notification_event_type = ANY($2)
            ORDER BY created_at DESC, notification_id DESC
            LIMIT $3
            "#,
            user.as_ref(),
            event_types,
            i64::from(limit),
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(ids)
    }
}

#[cfg(test)]
mod test;
