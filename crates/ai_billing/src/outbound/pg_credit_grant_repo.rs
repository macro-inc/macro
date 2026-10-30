//! Postgres adapter for operator credit grants on `ai_credit_ledger`.

#[cfg(test)]
mod test;

use super::pg_funding_repo::lock_payer;
use crate::domain::credit_grant::{CreditGrant, CreditGrantRepo};
use crate::domain::{BillingError, Result};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// Postgres-backed [`CreditGrantRepo`].
#[derive(Clone)]
pub struct PgCreditGrantRepo {
    pool: PgPool,
}

impl PgCreditGrantRepo {
    /// Create a repo over a connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn storage(e: impl Into<anyhow::Error>) -> BillingError {
    BillingError::Storage(e.into())
}

impl CreditGrantRepo for PgCreditGrantRepo {
    async fn record_credit_grant(
        &self,
        payer: &MacroUserIdStr<'_>,
        grant: &CreditGrant,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await.map_err(storage)?;
        // Same row lock as purchases and settlement, so a grant never lands
        // in the middle of a settlement's balance read.
        lock_payer(&mut tx, payer.as_ref()).await.map_err(storage)?;
        let result = sqlx::query!(
            r#"
            INSERT INTO ai_credit_ledger (id, user_id, kind, delta_cents, note)
            VALUES ($1, $2, 'grant', $3, $4)
            ON CONFLICT (id) DO NOTHING
            "#,
            grant.id,
            payer.as_ref(),
            i64::from(grant.amount_cents.get()),
            grant.note,
        )
        .execute(&mut *tx)
        .await
        .map_err(storage)?;
        tx.commit().await.map_err(storage)?;
        Ok(result.rows_affected() == 1)
    }

    async fn credit_grant_balance_cents(&self, payer: &MacroUserIdStr<'_>) -> Result<i64> {
        sqlx::query_scalar!(
            r#"
            SELECT COALESCE(SUM(delta_cents), 0)::bigint AS "balance!"
            FROM ai_credit_ledger
            WHERE user_id = $1
            "#,
            payer.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(storage)
    }
}
