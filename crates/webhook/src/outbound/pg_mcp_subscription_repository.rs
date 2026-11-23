//! PostgreSQL storage of MCP Events webhook subscriptions.
#[cfg(test)]
#[path = "pg_mcp_subscription_repository_test.rs"]
mod test;

use crate::domain::mcp::filter::McpEventFilter;
use crate::domain::mcp::live_subscribers::LIVE_SUBSCRIBERS_MAX_ROWS;
use crate::domain::mcp::models::{
    McpDeliveryProfile, McpEventSubscription, McpMatchCandidate, McpPreviousSecret,
    McpSecretCiphertext, McpSubscriptionId,
};
use crate::domain::mcp::ports::{McpStoreOutcome, McpSubscriptionRepo, McpSubscriptionUpsert};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

// `list_live_subscriber_ids` writes this limit as a literal.
const _: () = assert!(LIVE_SUBSCRIBERS_MAX_ROWS + 1 == 10_001);

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
    previous_secret_ciphertext: Option<Vec<u8>>,
    previous_secret_kms_key_id: Option<String>,
    previous_secret_encryption_version: Option<i16>,
    previous_secret_expires_at: Option<DateTime<Utc>>,
    delivery_profile: String,
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
        let profile = row
            .delivery_profile
            .parse::<McpDeliveryProfile>()
            .map_err(|error| decode_error("delivery_profile", error))?;
        // The four columns are written together; a row missing any part
        // has no previous secret.
        let previous_secret = match (
            row.previous_secret_ciphertext,
            row.previous_secret_kms_key_id,
            row.previous_secret_encryption_version,
            row.previous_secret_expires_at,
        ) {
            (Some(ciphertext), Some(kms_key_id), Some(encryption_version), Some(expires_at)) => {
                Some(McpPreviousSecret {
                    secret: McpSecretCiphertext {
                        ciphertext,
                        kms_key_id,
                        encryption_version,
                    },
                    expires_at,
                })
            }
            _ => None,
        };
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
            previous_secret,
            profile,
            expires_at: row.expires_at,
        })
    }
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
                secret_encryption_version, previous_secret_ciphertext,
                previous_secret_kms_key_id, previous_secret_encryption_version,
                previous_secret_expires_at, delivery_profile, expires_at
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
                secret_encryption_version, previous_secret_ciphertext,
                previous_secret_kms_key_id, previous_secret_encryption_version,
                previous_secret_expires_at, delivery_profile, expires_at
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

    #[tracing::instrument(skip_all, fields(quota_exceeded = tracing::field::Empty), err)]
    async fn store_within_quota(
        &self,
        upsert: McpSubscriptionUpsert,
        max: u32,
    ) -> Result<McpStoreOutcome, Self::Err> {
        let filter = serde_json::to_value(&upsert.filter)
            .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
        let events = upsert.filter.event_names();
        let user_id = upsert.key.user_id.as_ref();
        let previous = upsert.previous_secret.as_ref();
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        // One writer per user at a time, so concurrent subscribes cannot
        // both pass the quota.
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended('mcp-event-subscription:' || $1, 0))",
            user_id,
        )
        .execute(&mut *transaction)
        .await?;
        // A refresh replaces its own row, so it does not count against itself;
        // expired rows wait for the sweep and do not count either. The
        // (user, expiry) index reads only the user's live rows, at most the
        // quota.
        let others = sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "count!"
            FROM mcp_event_subscription
            WHERE user_id = $1 AND expires_at > now() AND subscription_id <> $2
            "#,
            user_id,
            upsert.subscription_id.as_str(),
        )
        .fetch_one(&mut *transaction)
        .await?;
        if others >= i64::from(max) {
            tracing::Span::current().record("quota_exceeded", true);
            transaction.rollback().await?;
            return Ok(McpStoreOutcome::QuotaExceeded);
        }
        // The key parts (user, URL, event type, arguments) are what the id is
        // derived from, so a conflict only refreshes the rest.
        let row = sqlx::query_as!(
            SubscriptionRow,
            r#"
            INSERT INTO mcp_event_subscription (
                id, user_id, subscription_id, event_type, arguments, filter,
                endpoint_url, secret_ciphertext, secret_kms_key_id,
                secret_encryption_version, previous_secret_ciphertext,
                previous_secret_kms_key_id, previous_secret_encryption_version,
                previous_secret_expires_at, delivery_profile, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (user_id, subscription_id) DO UPDATE SET
                filter = EXCLUDED.filter,
                secret_ciphertext = EXCLUDED.secret_ciphertext,
                secret_kms_key_id = EXCLUDED.secret_kms_key_id,
                secret_encryption_version = EXCLUDED.secret_encryption_version,
                previous_secret_ciphertext = EXCLUDED.previous_secret_ciphertext,
                previous_secret_kms_key_id = EXCLUDED.previous_secret_kms_key_id,
                previous_secret_encryption_version = EXCLUDED.previous_secret_encryption_version,
                previous_secret_expires_at = EXCLUDED.previous_secret_expires_at,
                delivery_profile = EXCLUDED.delivery_profile,
                expires_at = EXCLUDED.expires_at,
                updated_at = now()
            RETURNING id, user_id, subscription_id, event_type, arguments, filter,
                endpoint_url, secret_ciphertext, secret_kms_key_id,
                secret_encryption_version, previous_secret_ciphertext,
                previous_secret_kms_key_id, previous_secret_encryption_version,
                previous_secret_expires_at, delivery_profile, expires_at
            "#,
            upsert.id,
            user_id,
            upsert.subscription_id.as_str(),
            upsert.key.event_type,
            upsert.key.arguments,
            filter,
            upsert.key.endpoint_url,
            upsert.secret.ciphertext,
            upsert.secret.kms_key_id,
            upsert.secret.encryption_version,
            previous.map(|previous| previous.secret.ciphertext.as_slice()),
            previous.map(|previous| previous.secret.kms_key_id.as_str()),
            previous.map(|previous| previous.secret.encryption_version),
            previous.map(|previous| previous.expires_at),
            upsert.profile.as_ref(),
            upsert.expires_at,
        )
        .fetch_one(&mut *transaction)
        .await?;
        // The event names index the row for matching; a refresh may change
        // the filter and always changes the expiry, so they are rewritten.
        sqlx::query!(
            r#"
            DELETE FROM mcp_event_subscription_event
            WHERE subscription_row_id = $1
            "#,
            row.id,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO mcp_event_subscription_event (
                subscription_row_id, event_name, user_id, expires_at
            )
            SELECT $1, event_name, $3, $4
            FROM unnest($2::text[]) AS events(event_name)
            ON CONFLICT DO NOTHING
            "#,
            row.id,
            &events,
            user_id,
            row.expires_at,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(McpStoreOutcome::Stored(Box::new(row.try_into()?)))
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

    #[tracing::instrument(skip(self), err)]
    async fn delete_expired_batch(&self) -> Result<u64, Self::Err> {
        // The limit is `SWEEP_BATCH` written as a literal: as a bound
        // parameter, a generic plan does not know it and can read every
        // expired row to delete 500.
        let result = sqlx::query!(
            r#"
            DELETE FROM mcp_event_subscription
            WHERE id IN (
                SELECT id
                FROM mcp_event_subscription
                WHERE expires_at <= now()
                ORDER BY expires_at
                LIMIT 500
                FOR UPDATE SKIP LOCKED
            )
            "#,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
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

    // Not spanned: it runs every few seconds in every replica, outside any
    // request, and a trace per round would be noise.
    async fn list_live_subscriber_ids(&self) -> Result<Vec<String>, Self::Err> {
        // An index-only range over the live end of the expiry index, which
        // carries the user: expired rows waiting for the sweep are never read.
        // The order keeps the planner on that range. The limit is
        // `LIVE_SUBSCRIBERS_MAX_ROWS` plus one, written as a literal so a
        // generic plan knows it. The timeout ends a stuck read well within a
        // refresh interval, so the caller forgets the set and the next round
        // starts on time.
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '1s'")
            .execute(&mut *transaction)
            .await?;
        let user_ids = sqlx::query_scalar!(
            r#"
            SELECT user_id
            FROM mcp_event_subscription
            WHERE expires_at > now()
            ORDER BY expires_at
            LIMIT 10001
            "#,
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(user_ids)
    }

    #[tracing::instrument(skip_all, fields(audience_count = user_ids.len()), err)]
    async fn list_match_candidates(
        &self,
        user_ids: &[String],
        event_name: &str,
    ) -> Result<Vec<McpMatchCandidate>, Self::Err> {
        // Bounded by the audience the caller passes (at most 50 rows per
        // user), and under a timeout, so a slow match fails this try rather
        // than hold a connection; fan-out retries it within its time budget,
        // then drops the event's MCP deliveries.
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await?;
        let rows = sqlx::query!(
            r#"
            SELECT s.id, s.user_id, s.filter
            FROM mcp_event_subscription_event e
            JOIN mcp_event_subscription s ON s.id = e.subscription_row_id
            WHERE e.user_id = ANY($1) AND e.event_name = $2 AND e.expires_at > now()
                AND s.expires_at > now()
            "#,
            user_ids,
            event_name,
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        rows.into_iter()
            .map(|row| {
                Ok(McpMatchCandidate {
                    id: row.id,
                    user_id: MacroUserIdStr::try_from(row.user_id)
                        .map_err(|error| decode_error("user_id", error))?,
                    filter: serde_json::from_value(row.filter)
                        .map_err(|error| decode_error("filter", error))?,
                })
            })
            .collect()
    }
}
