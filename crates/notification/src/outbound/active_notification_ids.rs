//! Postgres reads of a user's active notification ids by event type.

use crate::domain::active_notification_ids::{
    ActiveNotificationIdRepository, ActiveNotificationIdStorageError,
};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

/// Postgres `query_canceled`, raised when a statement exceeds its timeout.
const QUERY_CANCELED: &str = "57014";

/// Adapter for the active notification id read over `user_notification`.
#[derive(Clone)]
pub struct PgActiveNotificationIdRepository(pub PgPool);

impl ActiveNotificationIdRepository for PgActiveNotificationIdRepository {
    async fn active_notification_ids(
        &self,
        user: MacroUserIdStr<'_>,
        event_types: &[String],
        limit: u32,
    ) -> Result<Vec<Uuid>, ActiveNotificationIdStorageError> {
        let failed = |error: sqlx::Error| ActiveNotificationIdStorageError::Failed(error.into());
        // No index leads with the event type, so a rare type walks the user's
        // live notifications newest first until the limit fills; bound it.
        let mut transaction = self.0.begin().await.map_err(failed)?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await
            .map_err(failed)?;
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
        .await
        .map_err(|error| {
            let code = error.as_database_error().and_then(|error| error.code());
            if code.as_deref() == Some(QUERY_CANCELED) {
                ActiveNotificationIdStorageError::TimedOut
            } else {
                failed(error)
            }
        })?;
        transaction.commit().await.map_err(failed)?;
        Ok(ids)
    }
}

#[cfg(test)]
mod test;
