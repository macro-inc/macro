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

    // 1_800 beyond per-seat allowances with 500 of credit and overage off.
    let outcome = repo
        .apply_settlement(&payer(), period_start, 1_800, policy(false))
        .await
        .unwrap();
    assert_eq!(outcome.consumed_credits_cents, 500);
    assert!(outcome.pending_charge.is_none());
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 0);
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.credits_consumed_cents, 500);

    // Same inputs again: nothing double-booked, remainder waits for overage.
    let again = repo
        .apply_settlement(&payer(), period_start, 1_800, policy(false))
        .await
        .unwrap();
    assert_eq!(again, SettlementOutcome::default());

    // Overage on: the 1_300 remainder is reserved as a pending charge.
    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    let charged = repo
        .apply_settlement(&payer(), period_start, 1_800, policy(false))
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
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
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
    // Payment failure is not terminal in Stripe: the open invoice may retry,
    // so it continues covering the usage.
    assert_eq!(ledger.overage_charged_cents, 1_300);
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
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
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
        1_300
    );

    // The next settlement hands the same charge back, with its invoice, even
    // though its continued ledger coverage leaves no new amount to plan.
    let retry = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
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
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn credits_can_replace_a_failed_charge_that_was_never_invoiced(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone());
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();

    let first = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    assert!(first.stripe_invoice_id.is_none());
    repo.finish_overage_charge(first.id, None, OverageChargeStatus::Failed)
        .await
        .unwrap();
    repo.record_credit_purchase(&payer(), 2_000, "cs_1")
        .await
        .unwrap();
    let covered = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap();
    assert_eq!(covered.consumed_credits_cents, 1_300);
    assert!(covered.pending_charge.is_none());
    let again = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap();
    assert_eq!(again, SettlementOutcome::default());
    assert_eq!(
        repo.latest_charge_status(&payer()).await.unwrap(),
        Some(OverageChargeStatus::Failed)
    );
    assert_eq!(charge_rows(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn credits_do_not_replace_a_failed_charge_with_a_collectible_invoice(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone());
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();

    let first = repo
        .apply_settlement(&payer(), period_start, 3_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    assert_eq!(first.amount_cents, 3_000);
    repo.finish_overage_charge(first.id, Some("in_open"), OverageChargeStatus::Failed)
        .await
        .unwrap();
    repo.suspend_overage(&payer()).await.unwrap();
    repo.record_credit_purchase(&payer(), 1_000, "cs_shrink")
        .await
        .unwrap();

    let suspended = repo
        .apply_settlement(&payer(), period_start, 3_000, policy(false))
        .await
        .unwrap();
    assert_eq!(suspended.consumed_credits_cents, 0);
    assert!(suspended.pending_charge.is_none());
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 1_000);
    assert_eq!(
        repo.period_ledger(&payer(), period_start)
            .await
            .unwrap()
            .overage_charged_cents,
        3_000
    );

    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    let retry = repo
        .apply_settlement(&payer(), period_start, 3_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("existing invoice retried");
    assert_eq!(retry.id, first.id);
    assert_eq!(retry.amount_cents, 3_000);
    assert_eq!(retry.stripe_invoice_id.as_deref(), Some("in_open"));
    assert_eq!(charge_rows(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settlement_collects_a_reservation_whose_collector_died(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone());
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();

    let reserved = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    // Fresh reservations are left to their collector...
    assert!(
        repo.apply_settlement(&payer(), period_start, 1_300, policy(false))
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
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
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
        .apply_settlement(&payer(), period_start, 900, policy(false))
        .await
        .unwrap();
    assert!(outcome.pending_charge.is_none());

    // Period ended: the 600 is flushed.
    let outcome = repo
        .apply_settlement(&payer(), period_start, 900, policy(true))
        .await
        .unwrap();
    assert_eq!(outcome.pending_charge.unwrap().amount_cents, 600);

    // Suspended: nothing more is reserved even with room.
    repo.update_overage(&payer(), true, 5_000).await.unwrap();
    repo.suspend_overage(&payer()).await.unwrap();
    let outcome = repo
        .apply_settlement(&payer(), period_start, 900, policy(true))
        .await
        .unwrap();
    assert!(outcome.pending_charge.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn period_allowance_roundtrips_and_upserts_per_period(pool: PgPool) {
    let repo = PgBillingRepo::new(pool);
    let start = Utc::now()
        .duration_trunc(chrono::Duration::microseconds(1))
        .unwrap();
    let earlier = start - chrono::Duration::days(30);
    let member = MacroUserIdStr::try_from("macro|member@example.com".to_string()).unwrap();
    let seats = vec![
        SeatAllowance {
            user: payer(),
            included_cents: 4_000,
        },
        SeatAllowance {
            user: member,
            included_cents: 20_000,
        },
    ];

    assert!(
        repo.period_allowance(&payer(), start)
            .await
            .unwrap()
            .is_none()
    );

    repo.remember_period_allowance(&payer(), start, &seats)
        .await
        .unwrap();
    let frozen = repo
        .period_allowance(&payer(), start)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frozen.seats, seats);

    // A later observation of the same (open) period refreshes.
    let max_payer = vec![SeatAllowance {
        user: payer(),
        included_cents: 20_000,
    }];
    repo.remember_period_allowance(&payer(), start, &max_payer)
        .await
        .unwrap();
    let frozen = repo
        .period_allowance(&payer(), start)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frozen.seats, max_payer);

    // A different period is independent.
    repo.remember_period_allowance(&payer(), earlier, &seats)
        .await
        .unwrap();
    assert_eq!(
        repo.period_allowance(&payer(), start)
            .await
            .unwrap()
            .unwrap()
            .seats,
        max_payer
    );
    assert_eq!(
        repo.period_allowance(&payer(), earlier)
            .await
            .unwrap()
            .unwrap()
            .seats,
        seats
    );
}
