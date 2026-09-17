use super::*;
use crate::domain::OVERAGE_CHARGE_THRESHOLD_CENTS;
use chrono::DurationRound;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn payer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|payer@example.com".to_string()).unwrap()
}

fn policy(period_ended: bool) -> SettlementPolicy {
    SettlementPolicy {
        overage_active: true,
        overage_limit_cents: 0,
        charge_threshold_cents: OVERAGE_CHARGE_THRESHOLD_CENTS,
        period_ended,
    }
}

/// How many `ai_overage_charge` rows the test payer has.
async fn charge_rows(pool: &PgPool) -> i64 {
    let payer = payer();
    sqlx::query_scalar!(
        r#"SELECT COUNT(*)::bigint AS "count!" FROM ai_overage_charge WHERE user_id = $1"#,
        payer.as_ref(),
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settings_default_and_roundtrip(pool: PgPool) {
    let repo = PgBillingRepo::new(pool);
    assert_eq!(
        repo.settings(&payer()).await.unwrap(),
        BillingSettings::default()
    );

    repo.update_overage(&payer(), true, 2_500).await.unwrap();
    // timestamptz keeps microseconds; compare at that precision.
    let start = Utc::now()
        .duration_trunc(chrono::Duration::microseconds(1))
        .unwrap();
    let end = start + chrono::Duration::days(30);
    repo.set_period(&payer(), start, end).await.unwrap();
    let s = repo.settings(&payer()).await.unwrap();
    assert!(s.overage_enabled);
    assert_eq!(s.overage_limit_cents, 2_500);
    assert_eq!(s.period_anchor, Some((start, end)));
    assert!(s.overage_suspended_at.is_none());

    repo.suspend_overage(&payer()).await.unwrap();
    assert!(
        repo.settings(&payer())
            .await
            .unwrap()
            .overage_suspended_at
            .is_some()
    );
    // Re-enabling clears the suspension.
    repo.update_overage(&payer(), true, 2_500).await.unwrap();
    assert!(
        repo.settings(&payer())
            .await
            .unwrap()
            .overage_suspended_at
            .is_none()
    );
    repo.suspend_overage(&payer()).await.unwrap();
    repo.clear_overage_suspension(&payer()).await.unwrap();
    assert!(
        repo.settings(&payer())
            .await
            .unwrap()
            .overage_suspended_at
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn credit_purchases_are_idempotent_on_stripe_reference(pool: PgPool) {
    let repo = PgBillingRepo::new(pool);
    assert!(
        repo.record_credit_purchase(&payer(), 2_500, "cs_a")
            .await
            .unwrap()
    );
    assert!(
        !repo
            .record_credit_purchase(&payer(), 2_500, "cs_a")
            .await
            .unwrap()
    );
    assert!(
        repo.record_credit_purchase(&payer(), 1_000, "cs_b")
            .await
            .unwrap()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 3_500);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settlement_consumes_credits_then_reserves_overage(pool: PgPool) {
    let repo = PgBillingRepo::new(pool);
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.record_credit_purchase(&payer(), 500, "cs_1")
        .await
        .unwrap();

    // 1_800 over allowance with 500 of credit and overage off: only credits.
    let outcome = repo
        .apply_settlement(&payer(), period_start, 5_800, 4_000, policy(false))
        .await
        .unwrap();
    assert_eq!(outcome.consumed_credits_cents, 500);
    assert!(outcome.pending_charge.is_none());
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 0);
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.credits_consumed_cents, 500);

    // Same inputs again: nothing double-booked, remainder waits for overage.
    let again = repo
        .apply_settlement(&payer(), period_start, 5_800, 4_000, policy(false))
        .await
        .unwrap();
    assert_eq!(again, SettlementOutcome::default());

    // Overage on: the 1_300 remainder is reserved as a pending charge.
    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    let charged = repo
        .apply_settlement(&payer(), period_start, 5_800, 4_000, policy(false))
        .await
        .unwrap();
    let pending = charged.pending_charge.expect("charge reserved");
    assert_eq!(pending.amount_cents, 1_300);
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.overage_charged_cents, 1_300);

    // Collected: invoice recorded and resolvable by the webhook.
    repo.finish_overage_charge(pending.id, Some("in_1"), OverageChargeStatus::Paid)
        .await
        .unwrap();
    assert_eq!(
        repo.latest_charge_status(&payer()).await.unwrap(),
        Some(OverageChargeStatus::Paid)
    );
    // Paid is terminal: a late failure webhook changes nothing and keeps the
    // usage covered.
    assert!(
        repo.resolve_overage_invoice("in_1", OverageChargeStatus::Failed)
            .await
            .unwrap()
            .is_none()
    );
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.overage_charged_cents, 1_300);
    assert!(
        repo.resolve_overage_invoice("in_unknown", OverageChargeStatus::Paid)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn invoice_webhooks_apply_out_of_order_without_unpaying(pool: PgPool) {
    let repo = PgBillingRepo::new(pool);
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    let pending = repo
        .apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    assert_eq!(pending.amount_cents, 1_300);
    assert!(pending.stripe_invoice_id.is_none());
    // The collector records the invoice before attempting payment.
    repo.finish_overage_charge(pending.id, Some("in_1"), OverageChargeStatus::Pending)
        .await
        .unwrap();
    assert_eq!(
        repo.latest_charge_status(&payer()).await.unwrap(),
        Some(OverageChargeStatus::Pending)
    );

    // Declined: the failure webhook lands first.
    let who = repo
        .resolve_overage_invoice("in_1", OverageChargeStatus::Failed)
        .await
        .unwrap();
    assert_eq!(who.unwrap().as_ref(), payer().as_ref());
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.overage_charged_cents, 0);
    // Re-reporting the same status is a no-op.
    assert!(
        repo.resolve_overage_invoice("in_1", OverageChargeStatus::Failed)
            .await
            .unwrap()
            .is_none()
    );

    // Stripe's retry collected it.
    assert!(
        repo.resolve_overage_invoice("in_1", OverageChargeStatus::Paid)
            .await
            .unwrap()
            .is_some()
    );
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.overage_charged_cents, 1_300);

    // A duplicate or late failure after that cannot un-pay it.
    assert!(
        repo.resolve_overage_invoice("in_1", OverageChargeStatus::Failed)
            .await
            .unwrap()
            .is_none()
    );
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.overage_charged_cents, 1_300);
    assert_eq!(
        repo.latest_charge_status(&payer()).await.unwrap(),
        Some(OverageChargeStatus::Paid)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settlement_retries_a_failed_charge_instead_of_reserving_a_new_one(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone());
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();

    let first = repo
        .apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    // The invoice was opened but payment failed at the provider.
    repo.finish_overage_charge(first.id, Some("in_1"), OverageChargeStatus::Failed)
        .await
        .unwrap();
    assert_eq!(
        repo.period_ledger(&payer(), period_start)
            .await
            .unwrap()
            .overage_charged_cents,
        0
    );

    // The next settlement hands the same charge back, with its invoice, and
    // reserves nothing new.
    let retry = repo
        .apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge retried");
    assert_eq!(retry.id, first.id);
    assert_eq!(retry.amount_cents, 1_300);
    assert_eq!(retry.stripe_invoice_id.as_deref(), Some("in_1"));
    assert_eq!(charge_rows(&pool).await, 1);
    assert_eq!(
        repo.period_ledger(&payer(), period_start)
            .await
            .unwrap()
            .overage_charged_cents,
        1_300
    );

    // It fails again; then credits arrive and cover the usage. The stale
    // failed charge must not be retried after that.
    repo.finish_overage_charge(first.id, None, OverageChargeStatus::Failed)
        .await
        .unwrap();
    repo.record_credit_purchase(&payer(), 2_000, "cs_1")
        .await
        .unwrap();
    let covered = repo
        .apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
        .await
        .unwrap();
    assert_eq!(covered.consumed_credits_cents, 1_300);
    assert!(covered.pending_charge.is_none());
    let again = repo
        .apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
        .await
        .unwrap();
    assert_eq!(again, SettlementOutcome::default());
    assert_eq!(
        repo.latest_charge_status(&payer()).await.unwrap(),
        Some(OverageChargeStatus::Failed)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settlement_collects_a_reservation_whose_collector_died(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone());
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();

    let reserved = repo
        .apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    // Fresh reservations are left to their collector...
    assert!(
        repo.apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
            .await
            .unwrap()
            .pending_charge
            .is_none()
    );
    // ...but one that never got an invoice after a while is handed back.
    sqlx::query!(
        "UPDATE ai_overage_charge SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
        reserved.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let orphan = repo
        .apply_settlement(&payer(), period_start, 5_300, 4_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("orphaned charge handed back");
    assert_eq!(orphan.id, reserved.id);
    assert!(orphan.stripe_invoice_id.is_none());
    assert_eq!(charge_rows(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settlement_uses_stored_overage_policy_and_flushes_at_period_end(pool: PgPool) {
    let repo = PgBillingRepo::new(pool);
    let period_start = Utc::now() - chrono::Duration::days(40);
    repo.update_overage(&payer(), true, 600).await.unwrap();

    // 900 over, cap 600, mid-period: 600 chargeable but under the $10 chunk.
    let outcome = repo
        .apply_settlement(&payer(), period_start, 4_900, 4_000, policy(false))
        .await
        .unwrap();
    assert!(outcome.pending_charge.is_none());

    // Period ended: the 600 is flushed.
    let outcome = repo
        .apply_settlement(&payer(), period_start, 4_900, 4_000, policy(true))
        .await
        .unwrap();
    assert_eq!(outcome.pending_charge.unwrap().amount_cents, 600);

    // Suspended: nothing more is reserved even with room.
    repo.update_overage(&payer(), true, 5_000).await.unwrap();
    repo.suspend_overage(&payer()).await.unwrap();
    let outcome = repo
        .apply_settlement(&payer(), period_start, 4_900, 4_000, policy(true))
        .await
        .unwrap();
    assert!(outcome.pending_charge.is_none());
}
