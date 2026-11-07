use anyhow::Result;
use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

use crate::domain::location::{FenceId, LocationDeviceRepo};

#[cfg(test)]
mod test;

/// PostgreSQL store for the phones that report their owner's place
/// crossings, and for when each place last ran its routine.
pub struct PgLocationRepo {
    pool: PgPool,
}

impl PgLocationRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl LocationDeviceRepo for PgLocationRepo {
    async fn create_device(
        &self,
        id: Uuid,
        owner: &MacroUserIdStr<'static>,
        token_hash: &[u8; 32],
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO scheduled_action_location_device (id, user_id, token_hash)
            VALUES ($1, $2, $3)
            "#,
            id,
            owner.as_ref(),
            token_hash.as_slice(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn delete_device(&self, id: Uuid, owner: &MacroUserIdStr<'static>) -> Result<bool> {
        let deleted = sqlx::query!(
            r#"
            DELETE FROM scheduled_action_location_device
            WHERE id = $1 AND user_id = $2
            "#,
            id,
            owner.as_ref(),
        )
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(deleted > 0)
    }

    async fn device_owner(&self, token_hash: &[u8; 32]) -> Result<Option<MacroUserIdStr<'static>>> {
        let owner = sqlx::query_scalar!(
            r#"
            SELECT user_id
            FROM scheduled_action_location_device
            WHERE token_hash = $1
            "#,
            token_hash.as_slice(),
        )
        .fetch_optional(&self.pool)
        .await?;
        owner
            .map(MacroUserIdStr::try_from)
            .transpose()
            .map_err(Into::into)
    }

    async fn claim_firing(&self, fence: &FenceId, cooldown: Duration) -> Result<bool> {
        let claimed = sqlx::query_scalar!(
            r#"
            INSERT INTO scheduled_action_location_firing (action_id, fence, fired_at)
            VALUES ($1, $2, now())
            ON CONFLICT (action_id, fence) DO UPDATE SET fired_at = now()
            WHERE scheduled_action_location_firing.fired_at <= now() - make_interval(secs => $3)
            RETURNING TRUE AS "claimed!"
            "#,
            fence.routine_id(),
            fence.to_string(),
            cooldown.as_seconds_f64(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(claimed.is_some())
    }
}
