#[cfg(test)]
mod test;

use crate::domain::ports::ChannelAccessCheck;
use sqlx::PgPool;
use uuid::Uuid;

/// Postgres-backed channel membership check.
pub struct PgChannelAccessCheck {
    pool: PgPool,
}

impl PgChannelAccessCheck {
    /// Create a new access check with the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ChannelAccessCheck for PgChannelAccessCheck {
    #[tracing::instrument(err, skip(self))]
    async fn is_channel_member(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> Result<bool, anyhow::Error> {
        let row = sqlx::query(
            "SELECT 1 FROM comms_channel_participants \
             WHERE channel_id = $1 AND user_id = $2 AND left_at IS NULL \
             LIMIT 1",
        )
        .bind(channel_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.is_some())
    }
}
