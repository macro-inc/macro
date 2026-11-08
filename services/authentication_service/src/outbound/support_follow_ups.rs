//! Postgres queue of support channel follow-ups waiting to be sent.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A follow-up no replica is working on right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingFollowUp {
    pub channel_id: Uuid,
    pub user_id: MacroUserIdStr<'static>,
    pub scheduled_at: DateTime<Utc>,
}

/// The `support_follow_ups` table.
#[derive(Clone)]
pub struct PgSupportFollowUps {
    db: PgPool,
}

impl PgSupportFollowUps {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    /// Queue a follow-up for a channel. Scheduling the same channel again keeps
    /// the first row and its message id.
    #[tracing::instrument(skip(self, user_id), err)]
    pub async fn schedule(
        &self,
        channel_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        message_id: Uuid,
    ) -> sqlx::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO support_follow_ups (channel_id, user_id, message_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (channel_id) DO NOTHING
            "#,
            channel_id,
            user_id.as_ref(),
            message_id,
        )
        .execute(&self.db)
        .await?;
        Ok(())
    }

    /// Follow-ups without a live claim, oldest first. Rows only live for the
    /// few minutes before they are sent, so this stays small.
    #[tracing::instrument(skip(self), err)]
    pub async fn unclaimed(&self) -> sqlx::Result<Vec<PendingFollowUp>> {
        sqlx::query_as!(
            PendingFollowUp,
            r#"
            SELECT channel_id, user_id AS "user_id: MacroUserIdStr<'static>", created_at AS scheduled_at
            FROM support_follow_ups
            WHERE claimed_until IS NULL OR claimed_until < NOW()
            ORDER BY created_at
            LIMIT 100
            "#,
        )
        .fetch_all(&self.db)
        .await
    }

    /// Claim a follow-up for one minute and return the message id to send it
    /// with, or `None` when another replica holds it or it is gone.
    #[tracing::instrument(skip(self), err)]
    pub async fn claim(&self, channel_id: Uuid) -> sqlx::Result<Option<Uuid>> {
        sqlx::query_scalar!(
            r#"
            UPDATE support_follow_ups
            SET claimed_until = NOW() + INTERVAL '1 minute'
            WHERE channel_id = $1
              AND (claimed_until IS NULL OR claimed_until < NOW())
            RETURNING message_id
            "#,
            channel_id,
        )
        .fetch_optional(&self.db)
        .await
    }

    /// Remove a follow-up once it has been sent or skipped.
    #[tracing::instrument(skip(self), err)]
    pub async fn finish(&self, channel_id: Uuid) -> sqlx::Result<()> {
        sqlx::query!(
            "DELETE FROM support_follow_ups WHERE channel_id = $1",
            channel_id,
        )
        .execute(&self.db)
        .await?;
        Ok(())
    }
}
