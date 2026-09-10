//! Postgres adapter for the billing tables (`ai_billing_account`,
//! `ai_credit_ledger`, `ai_overage_charge`).

#[cfg(test)]
mod test;

use crate::domain::{
    BillingError, BillingRepo, BillingSettings, OverageChargeStatus, PendingCharge, PeriodLedger,
    Result, SettlementOutcome, SettlementPolicy, SettlementState, plan_settlement,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

/// Postgres-backed [`BillingRepo`].
#[derive(Clone)]
pub struct PgBillingRepo {
    pool: PgPool,
}

impl PgBillingRepo {
    /// Create a repo over a connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn storage(e: sqlx::Error) -> BillingError {
    BillingError::Storage(e.into())
}

impl BillingRepo for PgBillingRepo {
    async fn settings(&self, payer: &MacroUserIdStr<'_>) -> Result<BillingSettings> {
        let row = sqlx::query!(
            r#"
            SELECT overage_enabled, overage_limit_cents, overage_suspended_at,
                   period_start, period_end
            FROM ai_billing_account
            WHERE user_id = $1
            "#,
            payer.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;

        Ok(row
            .map(|r| BillingSettings {
                overage_enabled: r.overage_enabled,
                overage_limit_cents: r.overage_limit_cents,
                overage_suspended_at: r.overage_suspended_at,
                period_anchor: r.period_start.zip(r.period_end),
            })
            .unwrap_or_default())
    }

    async fn update_overage(
        &self,
        payer: &MacroUserIdStr<'_>,
        enabled: bool,
        limit_cents: i64,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO ai_billing_account (user_id, overage_enabled, overage_limit_cents)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET overage_enabled = EXCLUDED.overage_enabled,
                overage_limit_cents = EXCLUDED.overage_limit_cents,
                overage_suspended_at = NULL,
                updated_at = NOW()
            "#,
            payer.as_ref(),
            enabled,
            limit_cents,
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }

    async fn set_period(
        &self,
        payer: &MacroUserIdStr<'_>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO ai_billing_account (user_id, period_start, period_end)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET period_start = EXCLUDED.period_start,
                period_end = EXCLUDED.period_end,
                updated_at = NOW()
            "#,
            payer.as_ref(),
            start,
            end,
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }

    async fn suspend_overage(&self, payer: &MacroUserIdStr<'_>) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO ai_billing_account (user_id, overage_suspended_at)
            VALUES ($1, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET overage_suspended_at = COALESCE(ai_billing_account.overage_suspended_at, NOW()),
                updated_at = NOW()
            "#,
            payer.as_ref(),
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }

    async fn clear_overage_suspension(&self, payer: &MacroUserIdStr<'_>) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE ai_billing_account
            SET overage_suspended_at = NULL, updated_at = NOW()
            WHERE user_id = $1
            "#,
            payer.as_ref(),
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }

    async fn credit_balance_cents(&self, payer: &MacroUserIdStr<'_>) -> Result<i64> {
        let balance = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(SUM(delta_cents), 0)::bigint AS "balance!"
            FROM ai_credit_ledger
            WHERE user_id = $1
            "#,
            payer.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;
        Ok(balance)
    }

    async fn period_ledger(
        &self,
        payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
    ) -> Result<PeriodLedger> {
        let mut conn = self.pool.acquire().await.map_err(storage)?;
        read_period_ledger(&mut conn, payer.as_ref(), period_start).await
    }

    async fn record_credit_purchase(
        &self,
        payer: &MacroUserIdStr<'_>,
        amount_cents: i64,
        stripe_reference: &str,
    ) -> Result<bool> {
        let id = macro_uuid::generate_uuid_v7();
        let result = sqlx::query!(
            r#"
            INSERT INTO ai_credit_ledger (id, user_id, kind, delta_cents, stripe_reference, note)
            VALUES ($1, $2, 'purchase', $3, $4, 'Credit pack purchase')
            ON CONFLICT (stripe_reference) WHERE stripe_reference IS NOT NULL DO NOTHING
            "#,
            id,
            payer.as_ref(),
            amount_cents,
            stripe_reference,
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(result.rows_affected() == 1)
    }

    async fn apply_settlement(
        &self,
        payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
        used_cents: i64,
        included_cents: i64,
        policy: SettlementPolicy,
    ) -> Result<SettlementOutcome> {
        let payer = payer.as_ref();
        let mut tx = self.pool.begin().await.map_err(storage)?;

        // Serialize settlements per payer on the account row.
        sqlx::query!(
            r#"
            INSERT INTO ai_billing_account (user_id) VALUES ($1)
            ON CONFLICT (user_id) DO NOTHING
            "#,
            payer,
        )
        .execute(&mut *tx)
        .await
        .map_err(storage)?;
        let account = sqlx::query!(
            r#"
            SELECT overage_enabled, overage_limit_cents, overage_suspended_at
            FROM ai_billing_account
            WHERE user_id = $1
            FOR UPDATE
            "#,
            payer,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(storage)?;

        let balance = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(SUM(delta_cents), 0)::bigint AS "balance!"
            FROM ai_credit_ledger
            WHERE user_id = $1
            "#,
            payer,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(storage)?;
        let ledger = read_period_ledger(&mut tx, payer, period_start).await?;

        let plan = plan_settlement(
            SettlementState {
                used_cents,
                included_cents,
                credits_consumed_cents: ledger.credits_consumed_cents,
                overage_charged_cents: ledger.overage_charged_cents,
                credit_balance_cents: balance,
            },
            SettlementPolicy {
                overage_active: account.overage_enabled
                    && account.overage_suspended_at.is_none()
                    && account.overage_limit_cents > 0,
                overage_limit_cents: account.overage_limit_cents,
                charge_threshold_cents: policy.charge_threshold_cents,
                period_ended: policy.period_ended,
            },
        );

        if plan.consume_credits_cents > 0 {
            sqlx::query!(
                r#"
                INSERT INTO ai_credit_ledger (id, user_id, kind, delta_cents, period_start, note)
                VALUES ($1, $2, 'consumption', $3, $4, 'AI usage beyond plan allowance')
                "#,
                macro_uuid::generate_uuid_v7(),
                payer,
                -plan.consume_credits_cents,
                period_start,
            )
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        }

        let pending_charge = if plan.charge_overage_cents > 0 {
            let id = macro_uuid::generate_uuid_v7();
            sqlx::query!(
                r#"
                INSERT INTO ai_overage_charge (id, user_id, period_start, amount_cents, status)
                VALUES ($1, $2, $3, $4, 'pending')
                "#,
                id,
                payer,
                period_start,
                plan.charge_overage_cents,
            )
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
            Some(PendingCharge {
                id,
                amount_cents: plan.charge_overage_cents,
            })
        } else {
            None
        };

        tx.commit().await.map_err(storage)?;
        Ok(SettlementOutcome {
            consumed_credits_cents: plan.consume_credits_cents,
            pending_charge,
        })
    }

    async fn finish_overage_charge(
        &self,
        charge_id: Uuid,
        stripe_invoice_id: Option<&str>,
        status: OverageChargeStatus,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE ai_overage_charge
            SET stripe_invoice_id = COALESCE($2, stripe_invoice_id),
                status = ($3::text)::ai_overage_charge_status,
                updated_at = NOW()
            WHERE id = $1
            "#,
            charge_id,
            stripe_invoice_id,
            status.to_string(),
        )
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }

    async fn resolve_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        status: OverageChargeStatus,
    ) -> Result<Option<MacroUserIdStr<'static>>> {
        let row = sqlx::query!(
            r#"
            UPDATE ai_overage_charge
            SET status = ($2::text)::ai_overage_charge_status, updated_at = NOW()
            WHERE stripe_invoice_id = $1
            RETURNING user_id
            "#,
            stripe_invoice_id,
            status.to_string(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?;
        row.map(|r| {
            MacroUserIdStr::try_from(r.user_id)
                .map_err(|e| BillingError::Storage(anyhow::anyhow!("invalid payer id: {e}")))
        })
        .transpose()
    }
}

/// Sum consumption and non-failed charges for a period, on any connection so
/// the settlement transaction can reuse it under its lock.
async fn read_period_ledger(
    conn: &mut sqlx::PgConnection,
    payer: &str,
    period_start: DateTime<Utc>,
) -> Result<PeriodLedger> {
    let consumed = sqlx::query_scalar!(
        r#"
        SELECT COALESCE(-SUM(delta_cents), 0)::bigint AS "consumed!"
        FROM ai_credit_ledger
        WHERE user_id = $1 AND kind = 'consumption' AND period_start = $2
        "#,
        payer,
        period_start,
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(storage)?;
    let charged = sqlx::query_scalar!(
        r#"
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS "charged!"
        FROM ai_overage_charge
        WHERE user_id = $1 AND period_start = $2 AND status <> 'failed'
        "#,
        payer,
        period_start,
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(storage)?;
    Ok(PeriodLedger {
        credits_consumed_cents: consumed,
        overage_charged_cents: charged,
    })
}
