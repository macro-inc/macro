//! Webhooks in Postgres, `database_webhooks`.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use models_databases::{DatabaseId, TableId};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{DatabaseWebhook, NewWebhook, WebhookId};
use crate::domain::ports::DatabaseWebhooksRepo;

/// [`DatabaseWebhooksRepo`] over MacroDB.
#[derive(Debug, Clone)]
pub struct PgWebhooksRepo {
    pool: PgPool,
}

impl PgWebhooksRepo {
    /// Webhooks kept in `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct WebhookRow {
    id: Uuid,
    database_id: Uuid,
    table_id: Uuid,
    created_by: String,
    token_prefix: String,
    created_at: DateTime<Utc>,
}

impl From<WebhookRow> for DatabaseWebhook {
    fn from(row: WebhookRow) -> Self {
        Self {
            id: row.id,
            database_id: DatabaseId::from_uuid(row.database_id),
            table_id: TableId::from_uuid(row.table_id),
            created_by: row.created_by,
            token_prefix: row.token_prefix,
            created_at: row.created_at,
        }
    }
}

impl DatabaseWebhooksRepo for PgWebhooksRepo {
    #[tracing::instrument(skip_all, err)]
    async fn insert_webhook(
        &self,
        webhook: NewWebhook,
    ) -> Result<DatabaseWebhook, rootcause::Report> {
        let row = sqlx::query_as!(
            WebhookRow,
            r#"
            INSERT INTO database_webhooks
                (id, database_id, table_id, created_by, token_hash, token_prefix)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, database_id, table_id, created_by, token_prefix, created_at
            "#,
            webhook.id,
            webhook.database_id.as_uuid(),
            webhook.table_id.as_uuid(),
            webhook.created_by,
            &webhook.token_hash[..],
            webhook.token_prefix,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.into())
    }

    #[tracing::instrument(skip(self), err)]
    async fn database_webhooks(
        &self,
        database_id: DatabaseId,
    ) -> Result<Vec<DatabaseWebhook>, rootcause::Report> {
        let rows = sqlx::query_as!(
            WebhookRow,
            r#"
            SELECT id, database_id, table_id, created_by, token_prefix, created_at
            FROM database_webhooks
            WHERE database_id = $1
            ORDER BY created_at, id
            "#,
            database_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_webhook(
        &self,
        database_id: DatabaseId,
        webhook_id: WebhookId,
    ) -> Result<bool, rootcause::Report> {
        let deleted = sqlx::query!(
            "DELETE FROM database_webhooks WHERE id = $1 AND database_id = $2",
            webhook_id,
            database_id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(deleted.rows_affected() > 0)
    }

    #[tracing::instrument(skip_all, err)]
    async fn webhook_by_token_hash(
        &self,
        token_hash: [u8; 32],
    ) -> Result<Option<DatabaseWebhook>, rootcause::Report> {
        let row = sqlx::query_as!(
            WebhookRow,
            r#"
            SELECT id, database_id, table_id, created_by, token_prefix, created_at
            FROM database_webhooks
            WHERE token_hash = $1
            "#,
            &token_hash[..],
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(Into::into))
    }
}
