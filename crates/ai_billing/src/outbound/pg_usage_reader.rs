//! Reads recorded AI usage from `ai_usage` at Macro's list rate.

use crate::domain::{BillingError, BillingPeriod, Result, UsageReader, list_rate_cents};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Rows recorded before a model had pricing carry a NULL total. Bill them at
/// the Opus rate rather than for free; `set_pricing` backfills them later.
const FALLBACK_PRICE_PER_MILLION_IN: f64 = 5.0;
const FALLBACK_PRICE_PER_MILLION_OUT: f64 = 25.0;

/// Postgres-backed [`UsageReader`] over the `ai_usage` table.
#[derive(Clone)]
pub struct PgUsageReader {
    pool: PgPool,
}

impl PgUsageReader {
    /// Create a reader over a connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UsageReader for PgUsageReader {
    async fn list_rate_usage_cents(
        &self,
        users: &[MacroUserIdStr<'static>],
        period: BillingPeriod,
    ) -> Result<i64> {
        if users.is_empty() {
            return Ok(0);
        }
        let ids: Vec<String> = users.iter().map(|u| u.as_ref().to_string()).collect();
        let provider_usd = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(SUM(
                COALESCE(
                    total::float8,
                    (input_tokens::float8 / 1000000.0) * $4
                        + (output_tokens::float8 / 1000000.0) * $5
                )
            ), 0)::float8 AS "usd!"
            FROM ai_usage
            WHERE user_id = ANY($1)
              AND created_at >= $2
              AND created_at < $3
            "#,
            &ids,
            period.start,
            period.end,
            FALLBACK_PRICE_PER_MILLION_IN,
            FALLBACK_PRICE_PER_MILLION_OUT,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Storage(e.into()))?;
        Ok(list_rate_cents(provider_usd))
    }
}
