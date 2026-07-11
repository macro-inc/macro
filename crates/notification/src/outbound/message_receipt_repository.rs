//! Database-backed implementation of [MessageReceiptRepo].
//!
//! This module provides a PostgreSQL adapter for tracking push notification
//! message delivery status and associating message IDs with user notifications.

#[cfg(test)]
mod test;

use crate::domain::models::email_notification_digest::ports::{MessageId, MessageReceiptRepo};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

/// Database-backed implementation of [MessageReceiptRepo].
///
/// Tracks push notification message IDs and their delivery status,
/// allowing the system to determine if all push notifications for
/// a user_notification have failed (triggering email fallback).
pub struct DbMessageReceiptRepository {
    db: PgPool,
}

impl DbMessageReceiptRepository {
    /// Create a new [DbMessageReceiptRepository] with the given database pool.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl MessageReceiptRepo for DbMessageReceiptRepository {
    #[tracing::instrument(err, skip(self))]
    async fn record_message_id(
        &self,
        message_id: MessageId,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<(), Report> {
        let user_id_str = user_id.to_string();

        sqlx::query!(
            r#"
            INSERT INTO notification_message_receipt (message_id, user_id, notification_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (message_id) DO NOTHING
            "#,
            message_id.0.as_str(),
            user_id_str,
            notification_id
        )
        .execute(&self.db)
        .await?;

        Ok(())
    }

    async fn mark_message_failed(
        &self,
        message_id: MessageId,
    ) -> Result<(MacroUserIdStr<'static>, Uuid), Report> {
        let row = sqlx::query!(
            r#"
            UPDATE notification_message_receipt
            SET failed = true, failed_at = NOW()
            WHERE message_id = $1
            RETURNING user_id, notification_id
            "#,
            message_id.0.as_str()
        )
        .fetch_one(&self.db)
        .await?;

        let user_id = MacroUserIdStr::parse_from_str(&row.user_id)
            .map(CowLike::into_owned)
            .map_err(|e| rootcause::report!(e))?;

        Ok((user_id, row.notification_id))
    }

    async fn did_all_messages_fail(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<bool, Report> {
        let user_id_str = user_id.to_string();

        // Check if there are ANY non-failed messages for this user_notification
        // If none exist that are not failed, then all have failed
        let has_non_failed = sqlx::query_scalar!(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM notification_message_receipt
                WHERE user_id = $1
                AND notification_id = $2
                AND failed = false
            ) as "exists!"
            "#,
            user_id_str,
            notification_id
        )
        .fetch_one(&self.db)
        .await?;

        // If no non-failed messages exist, all have failed
        Ok(!has_non_failed)
    }
}
