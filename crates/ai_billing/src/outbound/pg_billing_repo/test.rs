use super::*;
use crate::domain::{BillingPeriod, OVERAGE_CHARGE_THRESHOLD_CENTS};
use chrono::DurationRound;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn payer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|payer@example.com".to_string()).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_anchor_accepts_end_corrections_but_not_stale_or_overlapping_starts(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    let start = DateTime::from_timestamp(1_800_000_000, 0).unwrap();
    let end = start + chrono::Duration::days(30);
    repo.set_period(&payer(), start, end).await.unwrap();
    for corrected in [
        end + chrono::Duration::days(2),
        end - chrono::Duration::days(2),
    ] {
        repo.set_period(&payer(), start, corrected).await.unwrap();
        assert_eq!(
            repo.settings(&payer()).await.unwrap().period_anchor,
            Some((start, corrected))
        );
        for stale_start in [
            start - chrono::Duration::days(30),
            start + chrono::Duration::days(1),
        ] {
            repo.set_period(&payer(), stale_start, end).await.unwrap();
            assert_eq!(
                repo.settings(&payer()).await.unwrap().period_anchor,
                Some((start, corrected))
            );
        }
    }
    let next_start = end;
    let next_end = end + chrono::Duration::days(30);
    repo.set_period(&payer(), next_start, next_end)
        .await
        .unwrap();
    // A delayed correction for the old period must not rewind the new anchor.
    repo.set_period(&payer(), start, end + chrono::Duration::days(1))
        .await
        .unwrap();
    assert_eq!(
        repo.settings(&payer()).await.unwrap().period_anchor,
        Some((next_start, next_end))
    );
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
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
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
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
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
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
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
        repo.resolve_overage_invoice("in_1", &InvoiceOutcome::PaymentFailed)
            .await
            .unwrap()
            .is_none()
    );
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.overage_charged_cents, 1_300);
    assert!(
        repo.resolve_overage_invoice("in_unknown", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn invoice_webhooks_apply_out_of_order_without_unpaying(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
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
        .resolve_overage_invoice("in_1", &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    assert_eq!(who.unwrap().as_ref(), payer().as_ref());
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    // Payment failure is not terminal in Stripe: the open invoice may retry,
    // so it continues covering the usage.
    assert_eq!(ledger.overage_charged_cents, 1_300);
    // Re-reporting the same status is a no-op.
    assert!(
        repo.resolve_overage_invoice("in_1", &InvoiceOutcome::PaymentFailed)
            .await
            .unwrap()
            .is_none()
    );

    // Stripe's retry collected it.
    assert!(
        repo.resolve_overage_invoice("in_1", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_some()
    );
    let ledger = repo.period_ledger(&payer(), period_start).await.unwrap();
    assert_eq!(ledger.overage_charged_cents, 1_300);

    // A duplicate or late failure after that cannot un-pay it.
    assert!(
        repo.resolve_overage_invoice("in_1", &InvoiceOutcome::PaymentFailed)
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
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
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
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
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
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
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
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
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
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
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
async fn frozen_period_starts_lists_the_payers_periods_in_the_window(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let payer = payer();
    let other = MacroUserIdStr::try_from("macro|other@example.com".to_string()).unwrap();
    let now = Utc::now()
        .duration_trunc(chrono::Duration::microseconds(1))
        .unwrap();
    let month = chrono::Duration::days(30);
    let seats = |user: &MacroUserIdStr<'static>| {
        vec![SeatAllowance {
            user: user.clone(),
            included_cents: 2_000,
        }]
    };
    // Four consecutive periods frozen for the payer, out of order, and one
    // for someone else in the middle of them.
    let starts = [now - month * 3, now - month, now - month * 2, now];
    for start in starts {
        let period = BillingPeriod {
            start,
            end: start + month,
        };
        repo.store_open_allowance(
            &payer,
            period.open_start(start).unwrap(),
            &seats(&payer),
            SeatGeneration::from_raw(0),
        )
        .await
        .unwrap();
    }
    let other_period = BillingPeriod {
        start: now - month * 2,
        end: now - month,
    };
    repo.store_open_allowance(
        &other,
        other_period.open_start(other_period.start).unwrap(),
        &seats(&other),
        SeatGeneration::from_raw(0),
    )
    .await
    .unwrap();

    // Inclusive of `since`, exclusive of `before`, oldest first.
    assert_eq!(
        repo.frozen_period_starts(&payer, now - month * 2, now)
            .await
            .unwrap(),
        vec![now - month * 2, now - month]
    );
    assert_eq!(
        repo.frozen_period_starts(&payer, now - month * 3, now + month)
            .await
            .unwrap(),
        vec![now - month * 3, now - month * 2, now - month, now]
    );
    assert!(
        repo.frozen_period_starts(&payer, now + chrono::Duration::days(1), now + month)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn period_allowance_roundtrips_and_upserts_per_period(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let payer = payer();
    let now = Utc::now()
        .duration_trunc(chrono::Duration::microseconds(1))
        .unwrap();
    let period = BillingPeriod {
        start: now,
        end: now + chrono::Duration::days(30),
    };
    let open = period.open_start(now).unwrap();
    let earlier = open.start() - chrono::Duration::days(30);
    let member = MacroUserIdStr::try_from("macro|member@example.com".to_string()).unwrap();
    let seats = vec![
        SeatAllowance {
            user: payer.clone(),
            included_cents: 2_000,
        },
        SeatAllowance {
            user: member.clone(),
            included_cents: 1_000,
        },
    ];

    assert!(
        repo.period_allowance(&payer, open.start())
            .await
            .unwrap()
            .is_none()
    );

    assert_eq!(
        repo.store_open_allowance(&payer, open, &seats, SeatGeneration::from_raw(0))
            .await
            .unwrap(),
        AllowanceStore::Stored
    );
    let frozen = repo
        .period_allowance(&payer, open.start())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frozen.seats, seats);
    // Both columns carry the cost amounts; the legacy one keeps a pre-cutover binary working.
    let raw = raw_allowance(&pool, payer.as_ref(), open.start())
        .await
        .unwrap();
    assert_eq!(raw.included_cents_by_user, vec![2_000, 1_000]);
    assert_eq!(raw.included_cost_cents_by_user, Some(vec![2_000, 1_000]));

    // A later observation of the same open period refreshes.
    let max_payer = vec![SeatAllowance {
        user: payer.clone(),
        included_cents: 2_500,
    }];
    assert_eq!(
        repo.store_open_allowance(&payer, open, &max_payer, SeatGeneration::from_raw(0))
            .await
            .unwrap(),
        AllowanceStore::Stored
    );
    let frozen = repo
        .period_allowance(&payer, open.start())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(frozen.seats, max_payer);

    sqlx::query!(
        r#"
        INSERT INTO ai_billing_period_allowance (
            user_id, period_start, billed_users, included_cents_by_user,
            included_cost_cents_by_user
        )
        VALUES ($1, $2, $3, $4, $4)
        "#,
        payer.as_ref(),
        earlier,
        &vec![payer.as_ref().to_string(), member.as_ref().to_string()],
        &vec![2_000_i64, 1_000_i64],
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.period_allowance(&payer, open.start())
            .await
            .unwrap()
            .unwrap()
            .seats,
        max_payer
    );
    assert_eq!(
        repo.period_allowance(&payer, earlier)
            .await
            .unwrap()
            .unwrap()
            .seats,
        seats
    );
}

/// Thresholds that reload a balance below $10 back up to $100.
fn thresholds(monthly_limit_cents: Option<i64>) -> AutoReloadThresholds {
    AutoReloadThresholds {
        minimum_cents: 1_000,
        target_cents: 10_000,
        monthly_limit_cents,
    }
}

/// Turn auto-reload on for the test payer with `thresholds`.
async fn enable_auto_reload(repo: &PgBillingRepo, thresholds: &AutoReloadThresholds) {
    repo.update_auto_reload(&payer(), true, 50_000, Some(thresholds))
        .await
        .unwrap();
}

/// How many `ai_credit_reload` rows the test payer has.
async fn reload_rows(pool: &PgPool) -> i64 {
    let payer = payer();
    sqlx::query_scalar!(
        r#"SELECT COUNT(*)::bigint AS "count!" FROM ai_credit_reload WHERE user_id = $1"#,
        payer.as_ref(),
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn auto_reload_defaults_when_no_account_row_exists(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    let settings = repo.settings(&payer()).await.unwrap();
    assert_eq!(
        settings.auto_reload,
        AutoReloadThresholds {
            minimum_cents: 1_000,
            target_cents: 10_000,
            monthly_limit_cents: None,
        }
    );
    assert!(settings.auto_reload_suspended_at.is_none());

    // A row created by another write keeps the column defaults.
    repo.set_period(
        &payer(),
        Utc::now(),
        Utc::now() + chrono::Duration::days(30),
    )
    .await
    .unwrap();
    assert_eq!(
        repo.settings(&payer()).await.unwrap().auto_reload,
        AutoReloadThresholds::default()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_auto_reload_persists_thresholds_and_clears_both_suspensions(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    repo.suspend_overage(&payer()).await.unwrap();
    repo.suspend_auto_reload(&payer()).await.unwrap();
    let suspended = repo.settings(&payer()).await.unwrap();
    assert!(suspended.overage_suspended_at.is_some());
    assert!(suspended.auto_reload_suspended_at.is_some());

    let custom = AutoReloadThresholds {
        minimum_cents: 2_000,
        target_cents: 15_000,
        monthly_limit_cents: Some(30_000),
    };
    repo.update_auto_reload(&payer(), true, 30_000, Some(&custom))
        .await
        .unwrap();
    let s = repo.settings(&payer()).await.unwrap();
    assert!(s.overage_enabled);
    assert_eq!(s.overage_limit_cents, 30_000);
    assert_eq!(s.auto_reload, custom);
    assert!(s.overage_suspended_at.is_none());
    assert!(s.auto_reload_suspended_at.is_none());
    assert!(s.auto_reload_active());

    // Turning it off without thresholds keeps the stored ones.
    repo.update_auto_reload(&payer(), false, 0, None)
        .await
        .unwrap();
    let s = repo.settings(&payer()).await.unwrap();
    assert!(!s.overage_enabled);
    assert_eq!(s.overage_limit_cents, 0);
    assert_eq!(s.auto_reload, custom);
    assert!(!s.auto_reload_active());

    // A `Some` with no monthly limit really clears the limit.
    repo.update_auto_reload(&payer(), true, 50_000, Some(&thresholds(None)))
        .await
        .unwrap();
    assert_eq!(
        repo.settings(&payer()).await.unwrap().auto_reload,
        thresholds(None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_credit_reload_requires_opt_in_and_unsuspended_reloads(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    repo.record_credit_purchase(&payer(), 500, "cs_1")
        .await
        .unwrap();

    // Overage off: no reload even though the balance is below the minimum.
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );
    // Historical direct-charge suspension does not affect reload eligibility.
    // Saving with a zero direct-charge cap still allows reloads.
    repo.update_auto_reload(&payer(), true, 0, Some(&thresholds(None)))
        .await
        .unwrap();
    repo.suspend_overage(&payer()).await.unwrap();
    assert!(repo.settings(&payer()).await.unwrap().auto_reload_active());
    // Reloads suspended after a failed collection.
    enable_auto_reload(&repo, &thresholds(None)).await;
    repo.suspend_auto_reload(&payer()).await.unwrap();
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(reload_rows(&pool).await, 0);

    // Re-enabling lifts the reload suspension.
    enable_auto_reload(&repo, &thresholds(None)).await;
    let reload = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_eq!(reload.amount_cents, 9_500);
    assert!(reload.stripe_invoice_id.is_none());
    assert_eq!(reload_rows(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_credit_reload_subtracts_usage_the_settlement_will_consume(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    enable_auto_reload(&repo, &thresholds(None)).await;
    repo.record_credit_purchase(&payer(), 5_000, "cs_1")
        .await
        .unwrap();

    // 5_000 of credit is above the minimum on its own, but 4_500 of usage is
    // about to be consumed from it: effective 500, reload 9_500.
    let reload = repo
        .reserve_credit_reload(&payer(), period_start, 4_500, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_eq!(reload.amount_cents, 9_500);
    repo.finish_credit_reload(reload.id, Some("in_1"), CreditReloadStatus::Paid)
        .await
        .unwrap();

    // Usage already booked against the period no longer counts as uncovered.
    repo.apply_settlement(&payer(), period_start, 4_500, policy(false))
        .await
        .unwrap();
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 500);
    repo.record_credit_reload(&payer(), 9_500, "in_1")
        .await
        .unwrap();
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 4_500, now)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_credit_reload_honors_the_monthly_limit_including_pending_rows(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    enable_auto_reload(&repo, &thresholds(Some(12_000))).await;

    let first = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_eq!(first.amount_cents, 10_000);
    // Pending rows count against the limit, so once Stripe resolves this one
    // only 2_000 of room is left.
    repo.finish_credit_reload(first.id, Some("in_1"), CreditReloadStatus::Paid)
        .await
        .unwrap();
    let second = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_eq!(second.amount_cents, 2_000);
    repo.finish_credit_reload(second.id, Some("in_2"), CreditReloadStatus::Paid)
        .await
        .unwrap();
    // Limit spent: nothing more this month.
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(reload_rows(&pool).await, 2);

    // A failed reload does not count; a reload from last month does not either.
    sqlx::query!(
        "UPDATE ai_credit_reload SET created_at = $2 WHERE id = $1",
        second.id,
        BillingPeriod::calendar_month(now).start - chrono::Duration::hours(1),
    )
    .execute(&pool)
    .await
    .unwrap();
    let third = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_eq!(third.amount_cents, 2_000);
    repo.finish_credit_reload(third.id, None, CreditReloadStatus::Failed)
        .await
        .unwrap();
    // Suspension is what stops reloads after a failure, not the ledger.
    enable_auto_reload(&repo, &thresholds(Some(12_000))).await;
    let fourth = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_eq!(fourth.amount_cents, 2_000);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_credit_reload_waits_for_a_pending_reload_but_recovers_an_orphan(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    enable_auto_reload(&repo, &thresholds(None)).await;

    let reserved = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    // Fresh reservations are left to their collector...
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );
    // ...and so is one whose invoice is with Stripe, however old.
    repo.finish_credit_reload(reserved.id, Some("in_1"), CreditReloadStatus::Pending)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE ai_credit_reload SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
        reserved.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );

    // One that never got an invoice after a while is handed back.
    sqlx::query!(
        "UPDATE ai_credit_reload SET stripe_invoice_id = NULL WHERE id = $1",
        reserved.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let orphan = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("orphaned reload handed back");
    assert_eq!(orphan.id, reserved.id);
    assert_eq!(orphan.amount_cents, reserved.amount_cents);
    assert!(orphan.stripe_invoice_id.is_none());
    assert_eq!(reload_rows(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_credit_reload_retries_a_failed_reload_on_its_open_invoice(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    enable_auto_reload(&repo, &thresholds(Some(12_000))).await;

    let reserved = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    // The invoice reached Stripe, then collection failed and reloads were
    // suspended. Stripe keeps retrying that invoice.
    repo.finish_credit_reload(reserved.id, Some("in_1"), CreditReloadStatus::Failed)
        .await
        .unwrap();
    repo.suspend_auto_reload(&payer()).await.unwrap();
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );

    // Re-enabling hands back the same reload and invoice instead of opening a
    // second one Stripe could also collect.
    enable_auto_reload(&repo, &thresholds(Some(12_000))).await;
    let retried = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("failed reload handed back");
    assert_eq!(retried.id, reserved.id);
    assert_eq!(retried.amount_cents, 10_000);
    assert_eq!(retried.stripe_invoice_id.as_deref(), Some("in_1"));
    assert_eq!(reload_rows(&pool).await, 1);
    let status = sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM ai_credit_reload WHERE id = $1"#,
        reserved.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "pending");

    // While it is pending again it blocks new reloads, and once paid it
    // still counts against the month, leaving 2_000 of room.
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );
    repo.finish_credit_reload(retried.id, Some("in_1"), CreditReloadStatus::Paid)
        .await
        .unwrap();
    let next = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_eq!(next.amount_cents, 2_000);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn credit_reloads_are_idempotent_on_the_invoice(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    assert!(
        repo.record_credit_reload(&payer(), 9_500, "in_1")
            .await
            .unwrap()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 9_500);
    // The collector and the webhook may both report the same invoice.
    assert!(
        !repo
            .record_credit_reload(&payer(), 9_500, "in_1")
            .await
            .unwrap()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 9_500);
    // A manual purchase under the same reference is the same booking.
    assert!(
        !repo
            .record_credit_purchase(&payer(), 9_500, "in_1")
            .await
            .unwrap()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 9_500);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reload_invoice_webhooks_resolve_once_and_never_unpay(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    enable_auto_reload(&repo, &thresholds(None)).await;
    let reserved = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    repo.finish_credit_reload(reserved.id, Some("in_1"), CreditReloadStatus::Pending)
        .await
        .unwrap();

    assert!(
        repo.resolve_credit_reload_invoice("in_unknown", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_none()
    );
    // Declined first; re-reporting it is a no-op.
    let failed = repo
        .resolve_credit_reload_invoice("in_1", &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap()
        .expect("status changed");
    assert_eq!(failed.payer.as_ref(), payer().as_ref());
    assert_eq!(failed.amount_cents, 10_000);
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::PaymentFailed)
            .await
            .unwrap()
            .is_none()
    );
    // Stripe's retry collected it: reported exactly once.
    let paid = repo
        .resolve_credit_reload_invoice("in_1", &InvoiceOutcome::Paid)
        .await
        .unwrap()
        .expect("status changed");
    assert_eq!(paid.payer.as_ref(), payer().as_ref());
    assert_eq!(paid.amount_cents, 10_000);
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 10_000);
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_none()
    );
    // A late or duplicate failure cannot un-pay it.
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::PaymentFailed)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 10_000);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reload_invoice_credit_write_failure_leaves_paid_webhook_retryable(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    enable_auto_reload(&repo, &thresholds(None)).await;
    let reserved = repo
        .reserve_credit_reload(&payer(), now, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    repo.finish_credit_reload(reserved.id, Some("in_retry"), CreditReloadStatus::Pending)
        .await
        .unwrap();

    // Force the ledger INSERT to fail after the paid-status UPDATE executes.
    sqlx::query!(
        "ALTER TABLE ai_credit_ledger ADD CONSTRAINT reject_test_reload
         CHECK (stripe_reference <> 'in_retry')"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.resolve_credit_reload_invoice("in_retry", &InvoiceOutcome::Paid)
            .await
            .is_err()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 0);
    let status = sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM ai_credit_reload WHERE stripe_invoice_id = $1"#,
        "in_retry",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "pending");

    sqlx::query!("ALTER TABLE ai_credit_ledger DROP CONSTRAINT reject_test_reload")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.resolve_credit_reload_invoice("in_retry", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 10_000);
    // Re-delivery cannot issue the purchased credits twice.
    assert!(
        repo.resolve_credit_reload_invoice("in_retry", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 10_000);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reload_invoice_webhook_deduplicates_credits_booked_by_collector(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    let now = Utc::now();
    enable_auto_reload(&repo, &thresholds(None)).await;
    let reserved = repo
        .reserve_credit_reload(&payer(), now, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    repo.finish_credit_reload(
        reserved.id,
        Some("in_collector"),
        CreditReloadStatus::Pending,
    )
    .await
    .unwrap();
    repo.record_credit_reload(&payer(), reserved.amount_cents, "in_collector")
        .await
        .unwrap();

    assert!(
        repo.resolve_credit_reload_invoice("in_collector", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(
        repo.credit_balance_cents(&payer()).await.unwrap(),
        reserved.amount_cents
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn suspend_auto_reload_keeps_the_first_timestamp(pool: PgPool) {
    let repo = PgBillingRepo::new(pool, AiPricing::testing());
    repo.suspend_auto_reload(&payer()).await.unwrap();
    let first = repo
        .settings(&payer())
        .await
        .unwrap()
        .auto_reload_suspended_at
        .expect("suspended");
    repo.suspend_auto_reload(&payer()).await.unwrap();
    let s = repo.settings(&payer()).await.unwrap();
    assert_eq!(s.auto_reload_suspended_at, Some(first));
    // Reload suspension leaves overage itself alone.
    assert!(s.overage_suspended_at.is_none());

    // Clearing it leaves overage alone too, and is a no-op without a row.
    repo.suspend_overage(&payer()).await.unwrap();
    repo.clear_auto_reload_suspension(&payer()).await.unwrap();
    let s = repo.settings(&payer()).await.unwrap();
    assert!(s.auto_reload_suspended_at.is_none());
    assert!(s.overage_suspended_at.is_some());
    let other = MacroUserIdStr::try_from("macro|other@example.com".to_string()).unwrap();
    repo.clear_auto_reload_suspension(&other).await.unwrap();
    assert_eq!(
        repo.settings(&other).await.unwrap(),
        BillingSettings::default()
    );
}

async fn reload_status_of(pool: &PgPool, invoice: &str) -> String {
    sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM ai_credit_reload WHERE stripe_invoice_id = $1"#,
        invoice,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn charge_status_of(pool: &PgPool, invoice: &str) -> String {
    sqlx::query_scalar!(
        r#"SELECT status::text AS "status!" FROM ai_overage_charge WHERE stripe_invoice_id = $1"#,
        invoice,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

const HOSTED_URL: &str = "https://invoice.stripe.test/i/in_1";

fn action_required() -> InvoiceOutcome {
    InvoiceOutcome::ActionRequired {
        hosted_invoice_url: Some(HOSTED_URL.to_string()),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reload_invoice_reports_follow_the_transition_rules_and_keep_the_page(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    enable_auto_reload(&repo, &thresholds(None)).await;
    let reserved = repo
        .reserve_credit_reload(&payer(), now, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    repo.finish_credit_reload(reserved.id, Some("in_1"), CreditReloadStatus::Pending)
        .await
        .unwrap();
    assert_eq!(repo.payment_action(&payer()).await.unwrap(), None);

    // Authentication needed: the row remembers the hosted page and the
    // summary can point at it.
    let resolved = repo
        .resolve_credit_reload_invoice("in_1", &action_required())
        .await
        .unwrap()
        .expect("status changed");
    assert_eq!(resolved.amount_cents, 10_000);
    assert_eq!(reload_status_of(&pool, "in_1").await, "requires_action");
    assert_eq!(
        repo.payment_action(&payer()).await.unwrap(),
        Some(PaymentAction {
            kind: PaymentActionKind::CreditReload,
            amount_cents: 10_000,
            hosted_invoice_url: Some(HOSTED_URL.to_string()),
        })
    );
    assert_eq!(
        repo.latest_reload_status(&payer()).await.unwrap(),
        Some(CreditReloadStatus::RequiresAction)
    );
    // Re-reporting it is a no-op.
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &action_required())
            .await
            .unwrap()
            .is_none()
    );

    // Written off: no longer awaiting the payer, but a late decline cannot
    // revive it...
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::Uncollectible)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(repo.payment_action(&payer()).await.unwrap(), None);
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::PaymentFailed)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &action_required())
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(reload_status_of(&pool, "in_1").await, "uncollectible");
    // ...while a late payment still books the credits, once.
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::Paid)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 10_000);
    assert!(
        repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::Voided)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(reload_status_of(&pool, "in_1").await, "paid");

    // A void is final too.
    let second = repo
        .reserve_credit_reload(&payer(), now, 0, now)
        .await
        .unwrap();
    assert!(second.is_none(), "balance is at the target");
    let payer_id = payer();
    sqlx::query!(
        "INSERT INTO ai_credit_reload (id, user_id, amount_cents, stripe_invoice_id, status)
         VALUES ($1, $2, 500, 'in_2', 'pending')",
        macro_uuid::generate_uuid_v7(),
        payer_id.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.resolve_credit_reload_invoice("in_2", &InvoiceOutcome::Voided)
            .await
            .unwrap()
            .is_some()
    );
    for outcome in [
        InvoiceOutcome::Paid,
        InvoiceOutcome::PaymentFailed,
        InvoiceOutcome::Uncollectible,
        action_required(),
    ] {
        assert!(
            repo.resolve_credit_reload_invoice("in_2", &outcome)
                .await
                .unwrap()
                .is_none(),
            "{outcome:?}"
        );
    }
    assert_eq!(reload_status_of(&pool, "in_2").await, "voided");
    assert_eq!(repo.credit_balance_cents(&payer()).await.unwrap(), 10_000);
    assert_eq!(
        repo.latest_reload_status(&payer()).await.unwrap(),
        Some(CreditReloadStatus::Voided)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn closed_reloads_neither_block_nor_count_but_action_required_ones_do(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    enable_auto_reload(&repo, &thresholds(Some(12_000))).await;

    let first = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    repo.finish_credit_reload(first.id, Some("in_1"), CreditReloadStatus::Pending)
        .await
        .unwrap();
    // Awaiting the payer: blocks a new one however old it gets...
    repo.resolve_credit_reload_invoice("in_1", &action_required())
        .await
        .unwrap()
        .expect("status changed");
    sqlx::query!(
        "UPDATE ai_credit_reload SET updated_at = NOW() - INTERVAL '3 days' WHERE id = $1",
        first.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    // ...except that re-enabling reloads retries it on its invoice, as for a
    // failed one. (The service only reaches here once the payer re-enabled;
    // the repo itself does not know about the pause.)
    let retried = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("action-required reload handed back");
    assert_eq!(retried.id, first.id);
    assert_eq!(retried.stripe_invoice_id.as_deref(), Some("in_1"));
    assert_eq!(reload_status_of(&pool, "in_1").await, "pending");
    assert!(
        repo.reserve_credit_reload(&payer(), period_start, 0, now)
            .await
            .unwrap()
            .is_none()
    );

    // Voided: it stops blocking and no longer counts against the month, so
    // the next reload is a full one rather than the 2_000 left under the cap.
    repo.resolve_credit_reload_invoice("in_1", &InvoiceOutcome::Voided)
        .await
        .unwrap()
        .expect("status changed");
    let second = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_ne!(second.id, first.id);
    assert_eq!(second.amount_cents, 10_000);
    assert_eq!(reload_rows(&pool).await, 2);

    // Written off: the same.
    repo.finish_credit_reload(second.id, Some("in_2"), CreditReloadStatus::Pending)
        .await
        .unwrap();
    repo.resolve_credit_reload_invoice("in_2", &InvoiceOutcome::Uncollectible)
        .await
        .unwrap()
        .expect("status changed");
    let third = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    assert_ne!(third.id, second.id);
    assert_eq!(third.amount_cents, 10_000);
    assert_eq!(reload_rows(&pool).await, 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn closed_charges_stop_covering_and_action_required_ones_are_retried(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    let first = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    repo.finish_overage_charge(first.id, Some("in_1"), OverageChargeStatus::Pending)
        .await
        .unwrap();

    // Awaiting the payer: still covers the usage and shows in the summary.
    let who = repo
        .resolve_overage_invoice("in_1", &action_required())
        .await
        .unwrap()
        .expect("status changed");
    assert_eq!(who.as_ref(), payer().as_ref());
    assert_eq!(
        repo.period_ledger(&payer(), period_start)
            .await
            .unwrap()
            .overage_charged_cents,
        1_300
    );
    assert_eq!(
        repo.latest_charge_status(&payer()).await.unwrap(),
        Some(OverageChargeStatus::RequiresAction)
    );
    assert_eq!(
        repo.payment_action(&payer()).await.unwrap(),
        Some(PaymentAction {
            kind: PaymentActionKind::OverageCharge,
            amount_cents: 1_300,
            hosted_invoice_url: Some(HOSTED_URL.to_string()),
        })
    );
    // Once overage is active again it is retried on its invoice, not
    // reserved a second time.
    let retried = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("action-required charge handed back");
    assert_eq!(retried.id, first.id);
    assert_eq!(retried.stripe_invoice_id.as_deref(), Some("in_1"));
    assert_eq!(charge_status_of(&pool, "in_1").await, "pending");
    assert_eq!(charge_rows(&pool).await, 1);

    // Voided: the usage is uncovered again and a fresh charge is reserved
    // for it; the voided one is never retried.
    repo.resolve_overage_invoice("in_1", &InvoiceOutcome::Voided)
        .await
        .unwrap()
        .expect("status changed");
    assert_eq!(
        repo.period_ledger(&payer(), period_start)
            .await
            .unwrap()
            .overage_charged_cents,
        0
    );
    assert_eq!(repo.payment_action(&payer()).await.unwrap(), None);
    let second = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    assert_ne!(second.id, first.id);
    assert_eq!(second.amount_cents, 1_300);
    assert!(second.stripe_invoice_id.is_none());
    assert_eq!(charge_rows(&pool).await, 2);
    assert_eq!(
        repo.period_ledger(&payer(), period_start)
            .await
            .unwrap()
            .overage_charged_cents,
        1_300
    );

    // Written off: the same, and a late failure cannot revive it.
    repo.finish_overage_charge(second.id, Some("in_2"), OverageChargeStatus::Pending)
        .await
        .unwrap();
    repo.resolve_overage_invoice("in_2", &InvoiceOutcome::Uncollectible)
        .await
        .unwrap()
        .expect("status changed");
    assert!(
        repo.resolve_overage_invoice("in_2", &InvoiceOutcome::PaymentFailed)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        repo.period_ledger(&payer(), period_start)
            .await
            .unwrap()
            .overage_charged_cents,
        0
    );
    assert_eq!(
        repo.latest_charge_status(&payer()).await.unwrap(),
        Some(OverageChargeStatus::Uncollectible)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_invoices_are_the_old_collectible_ones_oldest_first(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    enable_auto_reload(&repo, &thresholds(None)).await;

    let charge = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    repo.finish_overage_charge(charge.id, Some("in_charge"), OverageChargeStatus::Pending)
        .await
        .unwrap();
    let reload = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    repo.finish_credit_reload(reload.id, Some("in_reload"), CreditReloadStatus::Pending)
        .await
        .unwrap();
    // One of each terminal and final state, plus a reservation that never
    // got an invoice: none of these are the provider's to report on.
    let payer_id = payer();
    for (invoice, status) in [
        ("in_paid", "paid"),
        ("in_void", "voided"),
        ("in_written_off", "uncollectible"),
    ] {
        sqlx::query!(
            "INSERT INTO ai_credit_reload (id, user_id, amount_cents, stripe_invoice_id, status, updated_at)
             VALUES ($1, $2, 500, $3, ($4::text)::ai_credit_reload_status, NOW() - INTERVAL '3 days')",
            macro_uuid::generate_uuid_v7(),
            payer_id.as_ref(),
            invoice,
            status,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        "INSERT INTO ai_overage_charge (id, user_id, period_start, amount_cents, status, updated_at)
         VALUES ($1, $2, $3, 500, 'failed', NOW() - INTERVAL '3 days')",
        macro_uuid::generate_uuid_v7(),
        payer_id.as_ref(),
        period_start,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Fresh rows are the webhook's.
    let stale = repo
        .stale_invoices(&payer(), now - chrono::Duration::hours(1))
        .await
        .unwrap();
    assert!(stale.is_empty(), "{stale:?}");

    // Age them: the reload longer than the charge, so it comes first.
    sqlx::query!(
        "UPDATE ai_credit_reload SET updated_at = NOW() - INTERVAL '2 hours' WHERE id = $1",
        reload.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE ai_overage_charge SET updated_at = NOW() - INTERVAL '90 minutes' WHERE id = $1",
        charge.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let stale = repo
        .stale_invoices(&payer(), now - chrono::Duration::hours(1))
        .await
        .unwrap();
    assert_eq!(
        stale,
        vec![
            StaleInvoice {
                kind: PaymentActionKind::CreditReload,
                stripe_invoice_id: "in_reload".to_string(),
            },
            StaleInvoice {
                kind: PaymentActionKind::OverageCharge,
                stripe_invoice_id: "in_charge".to_string(),
            },
        ]
    );

    // Awaiting the payer or declined with an open invoice: still the
    // provider's to report on. Final: not.
    repo.resolve_overage_invoice("in_charge", &action_required())
        .await
        .unwrap()
        .expect("status changed");
    repo.resolve_credit_reload_invoice("in_reload", &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap()
        .expect("status changed");
    assert!(
        repo.stale_invoices(&payer(), now - chrono::Duration::hours(1))
            .await
            .unwrap()
            .is_empty(),
        "a report resets the clock"
    );
    let stale = repo
        .stale_invoices(&payer(), now + chrono::Duration::hours(1))
        .await
        .unwrap();
    assert_eq!(stale.len(), 2, "{stale:?}");
    repo.resolve_overage_invoice("in_charge", &InvoiceOutcome::Paid)
        .await
        .unwrap()
        .expect("status changed");
    let stale = repo
        .stale_invoices(&payer(), now + chrono::Duration::hours(1))
        .await
        .unwrap();
    assert_eq!(
        stale,
        vec![StaleInvoice {
            kind: PaymentActionKind::CreditReload,
            stripe_invoice_id: "in_reload".to_string(),
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn payment_action_is_the_newest_across_charges_and_reloads(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let period_start = now - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    enable_auto_reload(&repo, &thresholds(None)).await;
    let charge = repo
        .apply_settlement(&payer(), period_start, 1_300, policy(false))
        .await
        .unwrap()
        .pending_charge
        .expect("charge reserved");
    repo.finish_overage_charge(charge.id, Some("in_charge"), OverageChargeStatus::Pending)
        .await
        .unwrap();
    let reload = repo
        .reserve_credit_reload(&payer(), period_start, 0, now)
        .await
        .unwrap()
        .expect("reload reserved");
    repo.finish_credit_reload(reload.id, Some("in_reload"), CreditReloadStatus::Pending)
        .await
        .unwrap();

    repo.resolve_credit_reload_invoice(
        "in_reload",
        &InvoiceOutcome::ActionRequired {
            hosted_invoice_url: None,
        },
    )
    .await
    .unwrap()
    .expect("status changed");
    // Without a page from the provider, the summary still says it is waiting.
    assert_eq!(
        repo.payment_action(&payer()).await.unwrap(),
        Some(PaymentAction {
            kind: PaymentActionKind::CreditReload,
            amount_cents: 10_000,
            hosted_invoice_url: None,
        })
    );
    sqlx::query!(
        "UPDATE ai_credit_reload SET updated_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
        reload.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.resolve_overage_invoice("in_charge", &action_required())
        .await
        .unwrap()
        .expect("status changed");
    assert_eq!(
        repo.payment_action(&payer()).await.unwrap(),
        Some(PaymentAction {
            kind: PaymentActionKind::OverageCharge,
            amount_cents: 1_300,
            hosted_invoice_url: Some(HOSTED_URL.to_string()),
        })
    );
    // Another payer's rows are not reported.
    let other = MacroUserIdStr::try_from("macro|other@example.com".to_string()).unwrap();
    assert_eq!(repo.payment_action(&other).await.unwrap(), None);
    assert!(
        repo.stale_invoices(&other, now + chrono::Duration::days(1))
            .await
            .unwrap()
            .is_empty()
    );
}

struct RawAllowance {
    billed_users: Vec<String>,
    included_cents_by_user: Vec<i64>,
    included_cost_cents_by_user: Option<Vec<i64>>,
    updated_at: chrono::DateTime<Utc>,
}

async fn raw_allowance(
    pool: &PgPool,
    payer: &str,
    period_start: chrono::DateTime<Utc>,
) -> Option<RawAllowance> {
    sqlx::query!(
        r#"
        SELECT billed_users AS "billed_users!",
               included_cents_by_user AS "included_cents_by_user!",
               included_cost_cents_by_user,
               updated_at
        FROM ai_billing_period_allowance
        WHERE user_id = $1 AND period_start = $2
        "#,
        payer,
        period_start,
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .map(|row| RawAllowance {
        billed_users: row.billed_users,
        included_cents_by_user: row.included_cents_by_user,
        included_cost_cents_by_user: row.included_cost_cents_by_user,
        updated_at: row.updated_at,
    })
}

async fn seat_generation(pool: &PgPool, payer: &str) -> Option<i64> {
    sqlx::query_scalar!(
        r#"SELECT seat_generation FROM ai_billing_account WHERE user_id = $1"#,
        payer,
    )
    .fetch_optional(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn release_open_seat_removes_the_middle_pair_and_leaves_the_closed_row(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let payer = payer();
    let now = Utc::now();
    let open_start = (now - chrono::Duration::days(1))
        .duration_trunc(chrono::Duration::microseconds(1))
        .unwrap();
    let open = BillingPeriod {
        start: open_start,
        end: now + chrono::Duration::days(20),
    }
    .open_start(now)
    .unwrap();
    let closed_start = open_start - chrono::Duration::days(60);
    let alice = MacroUserIdStr::try_from("macro|alice@example.com".to_string()).unwrap();
    let bob = MacroUserIdStr::try_from("macro|bob@example.com".to_string()).unwrap();
    let users = vec![
        payer.as_ref().to_string(),
        alice.as_ref().to_string(),
        bob.as_ref().to_string(),
    ];
    let open_cents = vec![100_i64, 100, 300];
    let closed_cents = vec![2_000_i64, 1_000, 2_000];
    let seeded_at = open_start - chrono::Duration::days(2);
    // The open row was frozen by this binary (cost column present); the closed
    // row below predates the cost column.
    sqlx::query!(
        r#"
        INSERT INTO ai_billing_period_allowance (
            user_id, period_start, billed_users, included_cents_by_user, updated_at,
            included_cost_cents_by_user
        )
        VALUES ($1, $2, $3, $4, $5, $4)
        "#,
        payer.as_ref(),
        open.start(),
        &users,
        &open_cents,
        seeded_at,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO ai_billing_period_allowance (
            user_id, period_start, billed_users, included_cents_by_user, updated_at
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
        payer.as_ref(),
        closed_start,
        &users,
        &closed_cents,
        seeded_at,
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.release_open_seat(&payer, open, &alice).await.unwrap();

    let open_row = raw_allowance(&pool, payer.as_ref(), open.start())
        .await
        .unwrap();
    assert_eq!(
        open_row.billed_users,
        vec![payer.as_ref().to_string(), bob.as_ref().to_string()]
    );
    assert_eq!(open_row.included_cents_by_user, vec![100, 300]);
    assert_eq!(open_row.included_cost_cents_by_user, Some(vec![100, 300]));
    assert_ne!(open_row.updated_at, seeded_at);
    let closed_row = raw_allowance(&pool, payer.as_ref(), closed_start)
        .await
        .unwrap();
    assert_eq!(closed_row.billed_users, users);
    assert_eq!(closed_row.included_cents_by_user, closed_cents);
    assert_eq!(closed_row.included_cost_cents_by_user, None);
    assert_eq!(closed_row.updated_at, seeded_at);
    assert_eq!(seat_generation(&pool, payer.as_ref()).await, Some(1));

    repo.release_open_seat(&payer, open, &alice).await.unwrap();

    let retried = raw_allowance(&pool, payer.as_ref(), open.start())
        .await
        .unwrap();
    assert_eq!(retried.billed_users, open_row.billed_users);
    assert_eq!(
        retried.included_cents_by_user,
        open_row.included_cents_by_user
    );
    assert_eq!(retried.updated_at, open_row.updated_at);
    assert_eq!(
        raw_allowance(&pool, payer.as_ref(), closed_start)
            .await
            .unwrap()
            .updated_at,
        seeded_at
    );
    assert_eq!(seat_generation(&pool, payer.as_ref()).await, Some(2));

    let outsider = MacroUserIdStr::try_from("macro|outsider@example.com".to_string()).unwrap();
    repo.release_open_seat(&payer, open, &outsider)
        .await
        .unwrap();
    let untouched = raw_allowance(&pool, payer.as_ref(), open.start())
        .await
        .unwrap();
    assert_eq!(untouched.billed_users, open_row.billed_users);
    assert_eq!(
        untouched.included_cents_by_user,
        open_row.included_cents_by_user
    );
    assert_eq!(untouched.updated_at, open_row.updated_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn store_open_allowance_does_not_write_a_stale_generation(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let open = BillingPeriod {
        start: (now - chrono::Duration::days(1))
            .duration_trunc(chrono::Duration::microseconds(1))
            .unwrap(),
        end: now + chrono::Duration::days(20),
    }
    .open_start(now)
    .unwrap();
    let alice = MacroUserIdStr::try_from("macro|alice@example.com".to_string()).unwrap();
    let bob = MacroUserIdStr::try_from("macro|bob@example.com".to_string()).unwrap();
    let before = vec![
        SeatAllowance {
            user: payer(),
            included_cents: 100,
        },
        SeatAllowance {
            user: alice.clone(),
            included_cents: 100,
        },
        SeatAllowance {
            user: bob.clone(),
            included_cents: 300,
        },
    ];
    let after = vec![
        SeatAllowance {
            user: payer(),
            included_cents: 100,
        },
        SeatAllowance {
            user: bob,
            included_cents: 300,
        },
    ];
    assert_eq!(
        repo.store_open_allowance(&payer(), open, &before, SeatGeneration::from_raw(0))
            .await
            .unwrap(),
        AllowanceStore::Stored
    );
    repo.release_open_seat(&payer(), open, &alice)
        .await
        .unwrap();

    assert_eq!(
        repo.store_open_allowance(&payer(), open, &before, SeatGeneration::from_raw(0))
            .await
            .unwrap(),
        AllowanceStore::Conflict
    );
    assert_eq!(
        repo.period_allowance(&payer(), open.start())
            .await
            .unwrap()
            .unwrap()
            .seats,
        after
    );

    assert_eq!(
        repo.store_open_allowance(&payer(), open, &after, SeatGeneration::from_raw(1))
            .await
            .unwrap(),
        AllowanceStore::Stored
    );
    assert_eq!(
        repo.period_allowance(&payer(), open.start())
            .await
            .unwrap()
            .unwrap()
            .seats,
        after
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn release_open_seat_without_an_allowance_row_bumps_generation(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let now = Utc::now();
    let open = BillingPeriod {
        start: (now - chrono::Duration::days(1))
            .duration_trunc(chrono::Duration::microseconds(1))
            .unwrap(),
        end: now + chrono::Duration::days(20),
    }
    .open_start(now)
    .unwrap();
    let member = MacroUserIdStr::try_from("macro|member@example.com".to_string()).unwrap();

    repo.release_open_seat(&payer(), open, &member)
        .await
        .unwrap();

    assert!(
        repo.period_allowance(&payer(), open.start())
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(seat_generation(&pool, payer().as_ref()).await, Some(1));
    assert_eq!(
        repo.store_open_allowance(
            &payer(),
            open,
            &[SeatAllowance {
                user: member.clone(),
                included_cents: 2_000,
            }],
            SeatGeneration::from_raw(0),
        )
        .await
        .unwrap(),
        AllowanceStore::Conflict
    );
    assert!(
        repo.period_allowance(&payer(), open.start())
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rows_frozen_before_the_cost_column_read_as_the_current_allowance(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let payer = payer();
    let member = MacroUserIdStr::try_from("macro|member@example.com".to_string()).unwrap();
    let users = vec![payer.as_ref().to_string(), member.as_ref().to_string()];
    let legacy_start = Utc::now() - chrono::Duration::days(40);
    let stale_start = legacy_start - chrono::Duration::days(30);
    // A pre-cutover binary wrote list-rate amounts and no cost column.
    sqlx::query!(
        r#"
        INSERT INTO ai_billing_period_allowance (
            user_id, period_start, billed_users, included_cents_by_user
        )
        VALUES ($1, $2, $3, $4)
        "#,
        payer.as_ref(),
        legacy_start,
        &users,
        &vec![4_000_i64, 20_000],
    )
    .execute(&pool)
    .await
    .unwrap();
    // An older binary refreshed the roster, leaving the cost column out of step.
    sqlx::query!(
        r#"
        INSERT INTO ai_billing_period_allowance (
            user_id, period_start, billed_users, included_cents_by_user,
            included_cost_cents_by_user
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
        payer.as_ref(),
        stale_start,
        &users,
        &vec![4_000_i64, 4_000],
        &vec![2_000_i64],
    )
    .execute(&pool)
    .await
    .unwrap();

    for start in [legacy_start, stale_start] {
        let seats = repo
            .period_allowance(&payer, start)
            .await
            .unwrap()
            .unwrap()
            .seats;
        assert_eq!(
            seats,
            vec![
                SeatAllowance {
                    user: payer.clone(),
                    included_cents: AiPricing::testing().included_allowance_cents(),
                },
                SeatAllowance {
                    user: member.clone(),
                    included_cents: AiPricing::testing().included_allowance_cents(),
                },
            ]
        );
    }

    // Releasing a seat from a pre-cutover row keeps the cost column empty rather
    // than excising a stale array positionally.
    let open = BillingPeriod {
        start: legacy_start,
        end: Utc::now() + chrono::Duration::days(20),
    }
    .open_start(Utc::now())
    .unwrap();
    repo.release_open_seat(&payer, open, &member).await.unwrap();
    let raw = raw_allowance(&pool, payer.as_ref(), legacy_start)
        .await
        .unwrap();
    assert_eq!(raw.billed_users, vec![payer.as_ref().to_string()]);
    assert_eq!(raw.included_cents_by_user, vec![4_000]);
    assert_eq!(raw.included_cost_cents_by_user, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn credit_only_settlement_never_reserves_or_retries_direct_charges(pool: PgPool) {
    let repo = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let period_start = Utc::now() - chrono::Duration::days(10);
    repo.update_overage(&payer(), true, 10_000).await.unwrap();
    let mut credit_only = policy(false);
    credit_only.overage_active = false;
    let outcome = repo
        .apply_settlement(&payer(), period_start, 5_000, credit_only)
        .await
        .unwrap();
    assert!(outcome.pending_charge.is_none());
    assert_eq!(charge_rows(&pool).await, 0);

    // Seed historical rows through the legacy policy, then retire collection.
    let historical = repo
        .apply_settlement(&payer(), period_start, 5_000, policy(false))
        .await
        .unwrap()
        .pending_charge
        .unwrap();
    for (status, invoice) in [
        (OverageChargeStatus::Pending, None),
        (OverageChargeStatus::Failed, None),
        (OverageChargeStatus::Failed, Some("in_legacy")),
    ] {
        repo.finish_overage_charge(historical.id, invoice, status)
            .await
            .unwrap();
        sqlx::query!(
            "UPDATE ai_overage_charge SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
            historical.id,
        )
        .execute(&pool)
        .await
        .unwrap();
        repo.update_overage(&payer(), true, 10_000).await.unwrap();
        let outcome = repo
            .apply_settlement(&payer(), period_start, 8_000, credit_only)
            .await
            .unwrap();
        assert!(outcome.pending_charge.is_none());
        assert_eq!(charge_rows(&pool).await, 1);
    }
}
