//! Postgres persistence for message open tracking.
use crate::domain::read_receipts::{MessageReadReceipt, ReadReceiptRepository, ReadReceiptToken};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{Report, prelude::IntoRootcause};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Read receipt adapter over `email_message_read_receipts` and `email_settings`.
#[derive(Debug, Clone)]
pub struct ReadReceiptPgRepository(pub PgPool);

impl ReadReceiptRepository for ReadReceiptPgRepository {
    #[tracing::instrument(skip(self), err)]
    async fn tracking_enabled(&self, link_id: Uuid) -> Result<bool, Report> {
        Ok(sqlx::query_scalar!(
            "SELECT read_receipts_enabled FROM email_settings WHERE link_id = $1",
            link_id
        )
        .fetch_optional(&self.0)
        .await?
        .unwrap_or(false))
    }

    #[tracing::instrument(skip(self, candidate), err)]
    async fn message_token(
        &self,
        message_id: Uuid,
        candidate: &ReadReceiptToken,
    ) -> Result<ReadReceiptToken, Report> {
        // The no-op update returns the existing token, including under a concurrent insert.
        let stored = sqlx::query_scalar!(
            r#"INSERT INTO email_message_read_receipts (message_id, token)
            VALUES ($1, $2)
            ON CONFLICT (message_id) DO UPDATE SET token = email_message_read_receipts.token
            RETURNING token"#,
            message_id,
            candidate.as_str(),
        )
        .fetch_one(&self.0)
        .await?;
        ReadReceiptToken::parse(&stored)
            .ok_or_else(|| rootcause::report!("stored read receipt token is malformed"))
    }

    #[tracing::instrument(skip(self, token), err)]
    async fn record_open(
        &self,
        token: &ReadReceiptToken,
        at: DateTime<Utc>,
        debounce_after: DateTime<Utc>,
    ) -> Result<bool, Report> {
        let counted = sqlx::query!(
            r#"UPDATE email_message_read_receipts r
            SET open_count = r.open_count + 1,
                first_opened_at = COALESCE(r.first_opened_at, $2),
                last_opened_at = $2
            FROM email_messages m
            WHERE r.token = $1
              AND m.id = r.message_id
              AND m.is_sent
              AND (r.last_opened_at IS NULL OR r.last_opened_at <= $3)"#,
            token.as_str(),
            at,
            debounce_after,
        )
        .execute(&self.0)
        .await?
        .rows_affected();
        Ok(counted > 0)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn accessible_inboxes(&self, user: &MacroUserIdStr<'_>) -> Result<Vec<Uuid>, Report> {
        Ok(
            email_db_client::links::get::fetch_inboxes_for_macro_id(&self.0, user.as_ref())
                .await
                .into_rootcause()?
                .into_iter()
                .map(|link| link.id)
                .collect(),
        )
    }

    #[tracing::instrument(skip(self, link_ids), err)]
    async fn thread_receipts(
        &self,
        thread_id: Uuid,
        link_ids: &[Uuid],
        limit: i64,
    ) -> Result<Vec<MessageReadReceipt>, Report> {
        let rows = sqlx::query!(
            r#"SELECT r.message_id, r.open_count, r.first_opened_at, r.last_opened_at
            FROM email_message_read_receipts r
            JOIN email_messages m ON m.id = r.message_id
            WHERE m.thread_id = $1 AND m.link_id = ANY($2) AND m.is_sent
            ORDER BY m.internal_date_ts DESC NULLS LAST, r.message_id
            LIMIT $3"#,
            thread_id,
            link_ids,
            limit,
        )
        .fetch_all(&self.0)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(MessageReadReceipt {
                    message_id: row.message_id,
                    open_count: u32::try_from(row.open_count)?,
                    first_opened_at: row.first_opened_at,
                    last_opened_at: row.last_opened_at,
                })
            })
            .collect()
    }
}
