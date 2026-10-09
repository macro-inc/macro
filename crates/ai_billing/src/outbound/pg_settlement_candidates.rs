//! Finds who the reconciliation sweep should settle, from the usage and
//! billing tables.

#[cfg(test)]
mod test;

use crate::domain::{BillingError, Result, SettlementCandidates};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Postgres-backed [`SettlementCandidates`].
#[derive(Clone)]
pub struct PgSettlementCandidates {
    pool: PgPool,
}

impl PgSettlementCandidates {
    /// Create a finder over a connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl SettlementCandidates for PgSettlementCandidates {
    async fn candidates(
        &self,
        since: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<Vec<MacroUserIdStr<'static>>> {
        // Counted usage is read through `ai_usage_created_at_idx`; the two
        // billing tables are small (one row per payer or reload). A reload
        // whose collector has not reported back in ten minutes was abandoned
        // (the process died between reserving and opening the invoice); the
        // same window `PgBillingRepo` uses to hand it back to the next
        // settlement. Retired direct usage charges are never retried, so
        // their table is not consulted.
        let rows = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT user_id AS "user_id!"
            FROM (
                SELECT user_id
                FROM ai_usage
                WHERE count_usage = TRUE
                  AND created_at >= $1
                UNION ALL
                SELECT user_id
                FROM ai_credit_reload
                WHERE status = 'pending'
                  AND stripe_invoice_id IS NULL
                  AND updated_at < $2::timestamptz - INTERVAL '10 minutes'
                UNION ALL
                SELECT user_id
                FROM ai_billing_account
                WHERE period_start >= $1::timestamptz
                   OR (period_end >= $1 AND period_end <= $2)
            ) AS candidates
            ORDER BY user_id
            "#,
            since,
            now,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Storage(e.into()))?;
        rows.into_iter()
            .map(|user_id| {
                MacroUserIdStr::try_from(user_id)
                    .map_err(|error| BillingError::Storage(error.into()))
            })
            .collect()
    }
}
