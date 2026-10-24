//! Webhook URL tokens, by hash.

use macro_uuid::Uuid;
use rootcause::Report;
use sqlx::PgPool;

use crate::domain::webhooks::{RoutineWebhook, RoutineWebhookRepository};

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

impl RoutineWebhookRepository for PgRoutineWebhookRepo {
    async fn replace(
        &self,
        action_id: Uuid,
        token_prefix: &str,
        token_hash: &[u8; 32],
    ) -> Result<RoutineWebhook, Report> {
        Ok(sqlx::query_as!(
            RoutineWebhook,
            r#"
            INSERT INTO scheduled_action_webhook (action_id, token_prefix, token_hash)
            VALUES ($1, $2, $3)
            ON CONFLICT (action_id) DO UPDATE
                SET token_prefix = EXCLUDED.token_prefix,
                    token_hash = EXCLUDED.token_hash,
                    created_at = now()
            RETURNING token_prefix, created_at
            "#,
            action_id,
            token_prefix,
            token_hash.as_slice(),
        )
        .fetch_one(&self.pool)
        .await?)
    }

    async fn get(&self, action_id: Uuid) -> Result<Option<RoutineWebhook>, Report> {
        Ok(sqlx::query_as!(
            RoutineWebhook,
            "SELECT token_prefix, created_at FROM scheduled_action_webhook WHERE action_id = $1",
            action_id,
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn find_action(&self, token_hash: &[u8; 32]) -> Result<Option<Uuid>, Report> {
        Ok(sqlx::query_scalar!(
            "SELECT action_id FROM scheduled_action_webhook WHERE token_hash = $1",
            token_hash.as_slice(),
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn delete(&self, action_id: Uuid) -> Result<(), Report> {
        sqlx::query!(
            "DELETE FROM scheduled_action_webhook WHERE action_id = $1",
            action_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
