//! PostgreSQL storage of MCP Events webhook subscriptions.
#[cfg(test)]
#[path = "pg_mcp_subscription_repository_test.rs"]
mod test;

use crate::domain::mcp::filter::McpEventFilter;
use crate::domain::mcp::models::{McpEventSubscription, McpSecretCiphertext, McpSubscriptionId};
use crate::domain::mcp::ports::{McpSubscriptionRepo, McpSubscriptionUpsert};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

/// PostgreSQL-backed [`McpSubscriptionRepo`].
#[derive(Clone)]
pub struct PgMcpSubscriptionRepository {
    pool: PgPool,
}

impl PgMcpSubscriptionRepository {
    /// Create the repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct SubscriptionRow {
    id: Uuid,
    user_id: String,
    subscription_id: String,
    event_type: String,
    arguments: Value,
    filter: Value,
    endpoint_url: String,
    secret_ciphertext: Vec<u8>,
    secret_kms_key_id: String,
    secret_encryption_version: i16,
    expires_at: DateTime<Utc>,
}

fn decode_error(
    column: &str,
    source: impl std::error::Error + Send + Sync + 'static,
) -> sqlx::Error {
    sqlx::Error::ColumnDecode {
        index: column.to_owned(),
        source: Box::new(source),
    }
}

impl TryFrom<SubscriptionRow> for McpEventSubscription {
    type Error = sqlx::Error;

    fn try_from(row: SubscriptionRow) -> Result<Self, Self::Error> {
        let user_id = MacroUserIdStr::try_from(row.user_id)
            .map_err(|error| decode_error("user_id", error))?;
        let filter = serde_json::from_value::<McpEventFilter>(row.filter)
            .map_err(|error| decode_error("filter", error))?;
        Ok(Self {
            id: row.id,
            user_id,
            subscription_id: McpSubscriptionId::from_stored(row.subscription_id),
            event_type: row.event_type,
            arguments: row.arguments,
            filter,
            endpoint_url: row.endpoint_url,
            secret: McpSecretCiphertext {
                ciphertext: row.secret_ciphertext,
                kms_key_id: row.secret_kms_key_id,
                encryption_version: row.secret_encryption_version,
            },
            expires_at: row.expires_at,
        })
    }
}

fn into_subscriptions(
    rows: Vec<SubscriptionRow>,
) -> Result<Vec<McpEventSubscription>, sqlx::Error> {
    rows.into_iter()
        .map(McpEventSubscription::try_from)
        .collect()
}

impl McpSubscriptionRepo for PgMcpSubscriptionRepository {
    type Err = sqlx::Error;

    #[tracing::instrument(skip_all, err)]
    async fn get(
        &self,
        user_id: &MacroUserIdStr<'static>,
        subscription_id: &McpSubscriptionId,
    ) -> Result<Option<McpEventSubscription>, Self::Err> {
        sqlx::query_as!(
            SubscriptionRow,
            r#"
            SELECT id, user_id, subscription_id, event_type, arguments, filter,
                endpoint_url, secret_ciphertext, secret_kms_key_id,
                secret_encryption_version, expires_at
            FROM mcp_event_subscription
            WHERE user_id = $1 AND subscription_id = $2
            "#,
            user_id.as_ref(),
            subscription_id.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(McpEventSubscription::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_live(&self, id: Uuid) -> Result<Option<McpEventSubscription>, Self::Err> {
        sqlx::query_as!(
            SubscriptionRow,
            r#"
            SELECT id, user_id, subscription_id, event_type, arguments, filter,
                endpoint_url, secret_ciphertext, secret_kms_key_id,
                secret_encryption_version, expires_at
            FROM mcp_event_subscription
            WHERE id = $1 AND expires_at > now()
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(McpEventSubscription::try_from)
        .transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn upsert(
        &self,
        upsert: McpSubscriptionUpsert,
    ) -> Result<McpEventSubscription, Self::Err> {
        let filter = serde_json::to_value(&upsert.filter)
            .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
        let events = upsert.filter.event_names();
        // The key parts (user, URL, event type, arguments) are what the id is
        // derived from, so a conflict only refreshes the rest.
        sqlx::query_as!(
            SubscriptionRow,
            r#"
            INSERT INTO mcp_event_subscription (
                id, user_id, subscription_id, event_type, arguments, filter, events,
                endpoint_url, secret_ciphertext, secret_kms_key_id,
                secret_encryption_version, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (user_id, subscription_id) DO UPDATE SET
                filter = EXCLUDED.filter,
                events = EXCLUDED.events,
                secret_ciphertext = EXCLUDED.secret_ciphertext,
                secret_kms_key_id = EXCLUDED.secret_kms_key_id,
                secret_encryption_version = EXCLUDED.secret_encryption_version,
                expires_at = EXCLUDED.expires_at,
                updated_at = now()
            RETURNING id, user_id, subscription_id, event_type, arguments, filter,
                endpoint_url, secret_ciphertext, secret_kms_key_id,
                secret_encryption_version, expires_at
            "#,
            upsert.id,
            upsert.key.user_id.as_ref(),
            upsert.subscription_id.as_str(),
            upsert.key.event_type,
            upsert.key.arguments,
            filter,
            &events,
            upsert.key.endpoint_url,
            upsert.secret.ciphertext,
            upsert.secret.kms_key_id,
            upsert.secret.encryption_version,
            upsert.expires_at,
        )
        .fetch_one(&self.pool)
        .await?
        .try_into()
    }

    #[tracing::instrument(skip_all, err)]
    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        subscription_id: &McpSubscriptionId,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM mcp_event_subscription
            WHERE user_id = $1 AND subscription_id = $2
            "#,
            user_id.as_ref(),
            subscription_id.as_str(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip_all, err)]
    async fn delete_expired(&self, user_id: &MacroUserIdStr<'static>) -> Result<u64, Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM mcp_event_subscription
            WHERE user_id = $1 AND expires_at <= now()
            "#,
            user_id.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip_all, err)]
    async fn count_live(&self, user_id: &MacroUserIdStr<'static>) -> Result<u32, Self::Err> {
        let count = sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "count!"
            FROM mcp_event_subscription
            WHERE user_id = $1 AND expires_at > now()
            "#,
            user_id.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;
        u32::try_from(count).map_err(|error| decode_error("count", error))
    }

    #[tracing::instrument(skip_all, err)]
    async fn has_live_endpoint(
        &self,
        user_id: &MacroUserIdStr<'static>,
        endpoint_url: &str,
    ) -> Result<bool, Self::Err> {
        sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM mcp_event_subscription
                WHERE user_id = $1 AND endpoint_url = $2 AND expires_at > now()
            ) AS "exists!"
            "#,
            user_id.as_ref(),
            endpoint_url,
        )
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(skip_all, fields(audience_count = user_ids.len()), err)]
    async fn list_live_matching(
        &self,
        user_ids: Vec<String>,
        event_name: &str,
    ) -> Result<Vec<McpEventSubscription>, Self::Err> {
        // Its cost grows with the audience (at most 50 rows per user), so it
        // runs under a timeout: ingestion retries the event rather than
        // holding a connection.
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query_as!(
            SubscriptionRow,
            r#"
            SELECT id, user_id, subscription_id, event_type, arguments, filter,
                endpoint_url, secret_ciphertext, secret_kms_key_id,
                secret_encryption_version, expires_at
            FROM mcp_event_subscription
            WHERE user_id = ANY($1) AND $2 = ANY(events) AND expires_at > now()
            "#,
            &user_ids,
            event_name,
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        into_subscriptions(rows)
    }
}
