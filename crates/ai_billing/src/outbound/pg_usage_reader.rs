//! Reads recorded AI usage from `ai_usage` at Macro's list rate.

#[cfg(test)]
mod test;

use crate::domain::{BillingError, BillingPeriod, Result, SeatUsage, UsageReader, list_rate_cents};
use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Rows recorded before a model had pricing carry a NULL total. Bill them at
/// the Opus 5 rate rather than for free; `set_pricing` backfills them later.
///
/// These mirror the `claude-opus-5` row seeded into `ai_pricing` by
/// `20260724182218_seed_claude_opus_5_pricing.sql` ($5 in / $25 out per
/// million tokens), the dearest model the picker offered when the fallback
/// was chosen. Keep them in step with that seed.
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
    async fn list_rate_usage_cents_by_user(
        &self,
        users: &[MacroUserIdStr<'static>],
        period: BillingPeriod,
    ) -> Result<Vec<SeatUsage>> {
        if users.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = users.iter().map(|u| u.as_ref().to_string()).collect();
        let rows = sqlx::query!(
            r#"
            SELECT user_id, COALESCE(SUM(
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
              AND feature <> $6
            GROUP BY user_id
            "#,
            &ids,
            period.start,
            period.end,
            FALLBACK_PRICE_PER_MILLION_IN,
            FALLBACK_PRICE_PER_MILLION_OUT,
            AiFeature::AiProjection.to_string(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Storage(e.into()))?;
        rows.into_iter()
            .map(|row| {
                let user = MacroUserIdStr::try_from(row.user_id)
                    .map_err(|error| BillingError::Storage(error.into()))?;
                Ok(SeatUsage {
                    user,
                    used_cents: list_rate_cents(row.usd),
                })
            })
            .collect()
    }
}
