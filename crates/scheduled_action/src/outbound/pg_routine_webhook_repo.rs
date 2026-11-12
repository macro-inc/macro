//! Routines' webhook URLs, kept by their token's SHA-256.

use macro_uuid::Uuid;
use rootcause::Report;
use sqlx::PgPool;

use crate::domain::webhooks::{RoutineWebhook, RoutineWebhookRepo};

#[cfg(test)]
mod test;

#[derive(Clone)]
pub struct PgRoutineWebhookRepo {
    pool: PgPool,
}

impl PgRoutineWebhookRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl RoutineWebhookRepo for PgRoutineWebhookRepo {
    async fn replace(
        &self,
        routine_id: Uuid,
        token_hash: [u8; 32],
        token_prefix: &str,
    ) -> Result<RoutineWebhook, Report> {
        Ok(sqlx::query_as!(
            RoutineWebhook,
            r#"
            INSERT INTO scheduled_action_webhook (action_id, token_hash, token_prefix)
            VALUES ($1, $2, $3)
            ON CONFLICT (action_id) DO UPDATE
                SET token_hash = EXCLUDED.token_hash,
                    token_prefix = EXCLUDED.token_prefix,
                    created_at = now()
            RETURNING action_id AS routine_id, token_prefix, created_at
            "#,
            routine_id,
            &token_hash[..],
            token_prefix,
        )
        .fetch_one(&self.pool)
        .await?)
    }

    async fn get(&self, routine_id: Uuid) -> Result<Option<RoutineWebhook>, Report> {
        Ok(sqlx::query_as!(
            RoutineWebhook,
            r#"
            SELECT action_id AS routine_id, token_prefix, created_at
            FROM scheduled_action_webhook WHERE action_id = $1
            "#,
            routine_id,
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn delete(&self, routine_id: Uuid) -> Result<(), Report> {
        sqlx::query!(
            "DELETE FROM scheduled_action_webhook WHERE action_id = $1",
            routine_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn routine_for(&self, token_hash: [u8; 32]) -> Result<Option<Uuid>, Report> {
        Ok(sqlx::query_scalar!(
            "SELECT action_id FROM scheduled_action_webhook WHERE token_hash = $1",
            &token_hash[..],
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn queued_deliveries(&self, routine_id: Uuid) -> Result<u32, Report> {
        let queued = sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "queued!" FROM scheduled_action_event_run
            WHERE action_id = $1 AND state = 'pending' AND event_context ? 'webhook'
            "#,
            routine_id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(u32::try_from(queued)?)
    }
}
