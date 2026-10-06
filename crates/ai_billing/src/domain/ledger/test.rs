use super::*;
use crate::domain::models::{
    AUTO_RELOAD_TARGET_MAX_CENTS, BillingError, OVERAGE_CHARGE_THRESHOLD_CENTS, PayerScope,
};
use crate::domain::pricing::AiPricing;
use chrono::{TimeZone, Utc};

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

fn policy(active: bool, limit: i64, ended: bool) -> SettlementPolicy {
    SettlementPolicy {
        overage_active: active,
        overage_limit_cents: limit,
        charge_threshold_cents: OVERAGE_CHARGE_THRESHOLD_CENTS,
        period_ended: ended,
    }
}

/// `used` and `included` are cost cents; the rest is customer money.
fn state(used: i64, included: i64, consumed: i64, charged: i64, balance: i64) -> SettlementState {
    SettlementState {
        chargeable_customer_cents: AiPricing::testing()
            .extra_customer_cents((used - included).max(0)),
        credits_consumed_cents: consumed,
        overage_charged_cents: charged,
        credit_balance_cents: balance,
    }
}

#[test]
fn included_allowance_is_each_plans_configured_amount_at_cost() {
    assert_eq!(
        PlanTier::Premium.included_ai_cents_per_seat(AiPricing::testing()),
        2_000
    );
    assert_eq!(
        PlanTier::Max.included_ai_cents_per_seat(AiPricing::testing()),
        10_000
    );
    assert_eq!(
        PlanTier::Free.included_ai_cents_per_seat(AiPricing::testing()),
        500
    );

    let mut team = Entitlement::personal(user("owner@x.com"), PlanTier::Premium);
    team.billed_users.push(user("a@x.com"));
    team.seat_tiers.push(PlanTier::Premium);
    team.billed_users.push(user("b@x.com"));
    team.seat_tiers.push(PlanTier::Premium);
    team.scope = PayerScope::TeamOwner {
        team_id: macro_uuid::generate_uuid_v7(),
    };
    assert_eq!(team.seats(), 3);
    assert_eq!(team.included_ai_cents(AiPricing::testing()), 2_000);
    assert_eq!(
        team.seat_allowances(AiPricing::testing())
            .into_iter()
            .map(|seat| seat.included_cents)
            .collect::<Vec<_>>(),
        vec![2_000, 2_000, 2_000]
    );
}

#[test]
fn mixed_seat_plans_keep_one_allowance_per_seat() {
    let mut team = Entitlement::personal(user("owner@x.com"), PlanTier::Premium);
    team.billed_users.push(user("a@x.com"));
    team.seat_tiers.push(PlanTier::Max);
    team.billed_users.push(user("b@x.com"));
    team.seat_tiers.push(PlanTier::Premium);
    team.scope = PayerScope::TeamOwner {
        team_id: macro_uuid::generate_uuid_v7(),
    };
    assert_eq!(team.seats(), 3);
    assert_eq!(team.included_ai_cents(AiPricing::testing()), 2_000);
    let allowances = team.seat_allowances(AiPricing::testing());
    assert_eq!(
        allowances
            .iter()
            .map(|seat| seat.user.as_ref())
            .collect::<Vec<_>>(),
        vec!["macro|owner@x.com", "macro|a@x.com", "macro|b@x.com"]
    );
    // Each seat gets its own plan's at-cost allowance.
    assert_eq!(
        allowances
            .into_iter()
            .map(|seat| seat.included_cents)
            .collect::<Vec<_>>(),
        vec![2_000, 10_000, 2_000]
    );
    assert_eq!(team.tier, PlanTier::Premium);
}

#[test]
fn nothing_to_settle_under_allowance() {
    let plan = plan_settlement(state(1_500, 2_000, 0, 0, 5_000), policy(true, 5_000, false));
    assert_eq!(plan, SettlementPlan::default());
}

#[test]
fn credits_cover_overflow_before_overage_at_the_markup() {
    // 700 cost cents over the allowance cost the customer 735.
    let plan = plan_settlement(state(2_700, 2_000, 0, 0, 5_000), policy(true, 5_000, false));
    assert_eq!(plan.consume_credits_cents, 735);
    assert_eq!(plan.charge_overage_cents, 0);
}

#[test]
fn already_consumed_credits_are_not_double_counted() {
    // 735 owed, 735 already consumed: settled.
    let plan = plan_settlement(
        state(2_700, 2_000, 735, 0, 4_265),
        policy(true, 5_000, false),
    );
    assert_eq!(plan, SettlementPlan::default());
}

#[test]
fn overage_waits_for_the_charge_threshold() {
    // 900 cost over is 945 owed, no credits: below the $10 chunk, nothing charged yet.
    let plan = plan_settlement(state(2_900, 2_000, 0, 0, 0), policy(true, 5_000, false));
    assert_eq!(plan.charge_overage_cents, 0);
    // 960 cost over is 1_008 owed: charged.
    let plan = plan_settlement(state(2_960, 2_000, 0, 0, 0), policy(true, 5_000, false));
    assert_eq!(plan.charge_overage_cents, 1_008);
}

#[test]
fn period_end_flushes_small_remainders_above_the_stripe_minimum() {
    let plan = plan_settlement(state(2_300, 2_000, 0, 0, 0), policy(true, 5_000, true));
    assert_eq!(plan.charge_overage_cents, 315);
    // Below Stripe's $0.50 floor the remainder is forgiven.
    let plan = plan_settlement(state(2_030, 2_000, 0, 0, 0), policy(true, 5_000, true));
    assert_eq!(plan.charge_overage_cents, 0);
}

#[test]
fn overage_respects_the_cap_and_prior_charges() {
    // 10_500 cost over is 11_025 owed; cap 5_000 with 4_500 already charged:
    // only 500 room, and 500 is below the threshold mid-period.
    let plan = plan_settlement(
        state(12_500, 2_000, 0, 4_500, 0),
        policy(true, 5_000, false),
    );
    assert_eq!(plan.charge_overage_cents, 0);
    // At period end the 500 is flushed.
    let plan = plan_settlement(state(12_500, 2_000, 0, 4_500, 0), policy(true, 5_000, true));
    assert_eq!(plan.charge_overage_cents, 500);
}

#[test]
fn overage_off_only_consumes_credits() {
    let plan = plan_settlement(state(7_000, 2_000, 0, 0, 2_000), policy(false, 0, false));
    assert_eq!(plan.consume_credits_cents, 2_000);
    assert_eq!(plan.charge_overage_cents, 0);
}

#[test]
fn settling_in_chunks_books_the_same_money_as_settling_once() {
    // First settlement at 1_000 cost over: 1_050 consumed.
    let first = plan_settlement(state(3_000, 2_000, 0, 0, 10_000), policy(false, 0, false));
    assert_eq!(first.consume_credits_cents, 1_050);
    // Later at 1_500 cost over: only the 525 difference, not extra(500) = 525 plus rounding.
    let second = plan_settlement(
        state(3_500, 2_000, 1_050, 0, 8_950),
        policy(false, 0, false),
    );
    assert_eq!(second.consume_credits_cents, 525);
    assert_eq!(
        first.consume_credits_cents + second.consume_credits_cents,
        AiPricing::testing().extra_customer_cents(1_500)
    );
}

fn reload_state(balance: i64, uncovered: i64, spent: i64) -> ReloadState {
    ReloadState {
        credit_balance_cents: balance,
        uncovered_cents: uncovered,
        spent_this_month_cents: spent,
    }
}

fn thresholds(minimum: i64, target: i64, monthly_limit: Option<i64>) -> AutoReloadThresholds {
    AutoReloadThresholds {
        minimum_cents: minimum,
        target_cents: target,
        monthly_limit_cents: monthly_limit,
    }
}

#[test]
fn no_reload_at_or_above_the_minimum() {
    let t = thresholds(1_000, 10_000, None);
    assert_eq!(plan_reload(reload_state(1_000, 0, 0), &t), None);
    assert_eq!(plan_reload(reload_state(5_000, 0, 0), &t), None);
    // Uncovered usage is subtracted first, but 1_500 - 500 still meets the minimum.
    assert_eq!(plan_reload(reload_state(1_500, 500, 0), &t), None);
}

#[test]
fn reload_tops_the_effective_balance_up_to_the_target() {
    let t = thresholds(1_000, 10_000, None);
    assert_eq!(plan_reload(reload_state(999, 0, 0), &t), Some(9_001));
    assert_eq!(plan_reload(reload_state(500, 0, 0), &t), Some(9_500));
    // Uncovered usage past the balance leaves a negative effective balance
    // that the reload also has to cover.
    assert_eq!(plan_reload(reload_state(500, 2_000, 0), &t), Some(11_500));
}

#[test]
fn monthly_limit_caps_the_reload() {
    let t = thresholds(1_000, 10_000, Some(5_000));
    assert_eq!(plan_reload(reload_state(0, 0, 0), &t), Some(5_000));
    assert_eq!(plan_reload(reload_state(0, 0, 3_000), &t), Some(2_000));
    // The limit is spent (or overspent): nothing left to reload.
    assert_eq!(plan_reload(reload_state(0, 0, 5_000), &t), None);
    assert_eq!(plan_reload(reload_state(0, 0, 6_000), &t), None);
}

#[test]
fn reload_below_the_stripe_minimum_is_skipped() {
    // Only 49 cents of monthly room left.
    let t = thresholds(1_000, 10_000, Some(5_000));
    assert_eq!(plan_reload(reload_state(0, 0, 4_951), &t), None);
    assert_eq!(plan_reload(reload_state(0, 0, 4_950), &t), Some(50));
}

#[test]
fn default_thresholds_are_valid() {
    let defaults = AutoReloadThresholds::default();
    assert_eq!(defaults, thresholds(1_000, 10_000, None));
    assert!(defaults.validate().is_ok());
}

#[test]
fn thresholds_reject_each_invalid_setting() {
    let invalid = [
        thresholds(0, 10_000, None),
        thresholds(-1, 10_000, None),
        thresholds(1_000, 1_049, None),
        thresholds(1_000, AUTO_RELOAD_TARGET_MAX_CENTS + 1, None),
        thresholds(1_000, 10_000, Some(0)),
        thresholds(1_000, 10_000, Some(-1)),
    ];
    for t in invalid {
        assert!(
            matches!(t.validate(), Err(BillingError::InvalidAutoReload(_))),
            "{t:?} should be invalid"
        );
    }

    assert!(thresholds(1_000, 1_050, None).validate().is_ok());
    assert!(
        thresholds(1_000, AUTO_RELOAD_TARGET_MAX_CENTS, Some(1))
            .validate()
            .is_ok()
    );
}

fn snapshot_for(
    tier: PlanTier,
    settings: BillingSettings,
    used: i64,
    ledger: PeriodLedger,
    balance: i64,
) -> UsageSnapshot {
    let u = user("me@x.com");
    let ent = Entitlement::personal(u.clone(), tier);
    let period = BillingPeriod::calendar_month(Utc::now());
    let chargeable = AiPricing::testing()
        .extra_customer_cents((used - ent.included_ai_cents(AiPricing::testing())).max(0));
    build_snapshot(
        &u,
        &ent,
        &settings,
        period,
        used,
        chargeable,
        ledger,
        balance,
        AiPricing::testing(),
    )
}

#[test]
fn gate_allows_within_allowance_and_blocks_after() {
    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        1_999,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(s.remaining_cents, 1);
    assert_eq!(decide(&s), AllowanceDecision::Allow);

    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        2_000,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(s.remaining_cents, 0);
    assert_eq!(
        decide(&s),
        AllowanceDecision::Deny(DenyReason::AllowanceExhausted)
    );
    assert_eq!(s.blocked_reason, Some(DenyReason::AllowanceExhausted));
}

#[test]
fn gate_counts_unsettled_usage_against_credits() {
    // 500 cost over allowance is 525 owed, not yet settled, 300 of credit: 300 - 525 < 0.
    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        2_500,
        PeriodLedger::default(),
        300,
    );
    assert_eq!(s.uncovered_cents, 525);
    assert_eq!(s.remaining_cents, 0);
    assert_eq!(
        decide(&s),
        AllowanceDecision::Deny(DenyReason::AllowanceExhausted)
    );

    // Once settled (525 consumed), the 800 balance pays for 761 cost cents more.
    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        2_500,
        PeriodLedger {
            credits_consumed_cents: 525,
            overage_charged_cents: 0,
        },
        800,
    );
    assert_eq!(s.uncovered_cents, 0);
    assert_eq!(s.remaining_cents, 761);
    assert_eq!(decide(&s), AllowanceDecision::Allow);
}

#[test]
fn gate_uses_overage_room_and_reports_the_cap() {
    let settings = BillingSettings {
        overage_enabled: true,
        overage_limit_cents: 2_000,
        ..Default::default()
    };
    let s = snapshot_for(
        PlanTier::Premium,
        settings.clone(),
        3_500,
        PeriodLedger::default(),
        0,
    );
    // 1_500 cost over is 1_575 owed against 2_000 of room: 425 left pays for 404 cost cents.
    assert_eq!(s.uncovered_cents, 1_575);
    assert_eq!(s.remaining_cents, 404);
    assert_eq!(decide(&s), AllowanceDecision::Allow);

    let s = snapshot_for(
        PlanTier::Premium,
        settings,
        4_000,
        PeriodLedger {
            credits_consumed_cents: 0,
            overage_charged_cents: 2_000,
        },
        0,
    );
    assert_eq!(s.remaining_cents, 0);
    assert_eq!(
        decide(&s),
        AllowanceDecision::Deny(DenyReason::OverageLimitReached)
    );
}

#[test]
fn a_single_cent_of_headroom_does_not_pay_for_marked_up_usage() {
    // 1 customer cent covers 0 cost cents at the markup; 2 cover 1.
    for (balance, remaining) in [(1, 0), (2, 1)] {
        let s = snapshot_for(
            PlanTier::Premium,
            BillingSettings::default(),
            2_000,
            PeriodLedger::default(),
            balance,
        );
        assert_eq!(s.remaining_cents, remaining);
    }
}

#[test]
fn gate_reports_failed_payment_when_suspended() {
    let settings = BillingSettings {
        overage_enabled: true,
        overage_limit_cents: 2_000,
        overage_suspended_at: Some(Utc::now()),
        ..Default::default()
    };
    let s = snapshot_for(
        PlanTier::Premium,
        settings,
        2_500,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(
        decide(&s),
        AllowanceDecision::Deny(DenyReason::OveragePaymentFailed)
    );
}

#[test]
fn snapshot_reports_auto_reload_settings_and_activity() {
    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        0,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(s.auto_reload.minimum_balance_cents, 1_000);
    assert_eq!(s.auto_reload.target_balance_cents, 10_000);
    assert_eq!(s.auto_reload.monthly_spend_limit_cents, None);
    assert!(!s.auto_reload.suspended);
    assert!(!s.auto_reload.active, "overage off: reloads never fire");

    let settings = BillingSettings {
        overage_enabled: true,
        overage_limit_cents: 2_000,
        auto_reload: thresholds(2_000, 20_000, Some(50_000)),
        ..Default::default()
    };
    let s = snapshot_for(
        PlanTier::Premium,
        settings.clone(),
        0,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(s.auto_reload.minimum_balance_cents, 2_000);
    assert_eq!(s.auto_reload.target_balance_cents, 20_000);
    assert_eq!(s.auto_reload.monthly_spend_limit_cents, Some(50_000));
    assert!(s.auto_reload.active);

    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings {
            auto_reload_suspended_at: Some(Utc::now()),
            ..settings
        },
        0,
        PeriodLedger::default(),
        0,
    );
    assert!(s.auto_reload.suspended);
    assert!(!s.auto_reload.active);
}

#[test]
fn free_users_are_hard_capped_at_the_free_allowance() {
    let s = snapshot_for(
        PlanTier::Free,
        BillingSettings::default(),
        499,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(s.included_cents, 500);
    assert_eq!(s.remaining_cents, 1);
    assert_eq!(decide(&s), AllowanceDecision::Allow);

    // Leftover credits or an (impossible) overage setting never extend the cap.
    let s = snapshot_for(
        PlanTier::Free,
        BillingSettings {
            overage_enabled: true,
            overage_limit_cents: 10_000,
            ..Default::default()
        },
        500,
        PeriodLedger::default(),
        5_000,
    );
    assert_eq!(s.remaining_cents, 0);
    assert_eq!(
        decide(&s),
        AllowanceDecision::Deny(DenyReason::FreeAllowanceExhausted)
    );
    assert_eq!(s.blocked_reason, Some(DenyReason::FreeAllowanceExhausted));
    assert_eq!(
        DenyReason::FreeAllowanceExhausted.code(),
        "ai_free_allowance_exhausted"
    );
}

#[test]
fn unlimited_is_never_blocked() {
    let u = user("ent@x.com");
    let mut ent = Entitlement::personal(u.clone(), PlanTier::Premium);
    ent.unlimited = true;
    let s = build_snapshot(
        &u,
        &ent,
        &BillingSettings::default(),
        BillingPeriod::calendar_month(Utc::now()),
        99_999,
        AiPricing::testing().extra_customer_cents(97_999),
        PeriodLedger::default(),
        0,
        AiPricing::testing(),
    );
    assert_eq!(decide(&s), AllowanceDecision::Allow);
    assert_eq!(s.remaining_cents, i64::MAX);
}

#[test]
fn team_member_is_not_the_payer() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let ent = Entitlement {
        tier: PlanTier::Max,
        seat_tiers: vec![PlanTier::Max, PlanTier::Max],
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner, member.clone()],
        scope: PayerScope::TeamMember {
            team_id: macro_uuid::generate_uuid_v7(),
        },
    };
    let s = build_snapshot(
        &member,
        &ent,
        &BillingSettings::default(),
        BillingPeriod::calendar_month(Utc::now()),
        0,
        0,
        PeriodLedger::default(),
        0,
        AiPricing::testing(),
    );
    assert!(!s.can_manage_billing);
    assert_eq!(s.seats, 2);
    assert_eq!(s.included_cents, 10_000);
}

#[test]
fn billing_period_uses_anchor_and_rolls_forward() {
    let start = Utc.with_ymd_and_hms(2026, 1, 15, 0, 0, 0).unwrap();
    let end = Utc.with_ymd_and_hms(2026, 2, 15, 0, 0, 0).unwrap();

    let inside = Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap();
    assert_eq!(
        BillingPeriod::current(Some((start, end)), inside),
        BillingPeriod { start, end }
    );

    // Webhook has not moved the anchor yet: roll forward two periods.
    let later = Utc.with_ymd_and_hms(2026, 3, 20, 0, 0, 0).unwrap();
    let rolled = BillingPeriod::current(Some((start, end)), later);
    assert_eq!(
        rolled.start,
        Utc.with_ymd_and_hms(2026, 3, 15, 0, 0, 0).unwrap()
    );
    assert_eq!(
        rolled.end,
        Utc.with_ymd_and_hms(2026, 4, 15, 0, 0, 0).unwrap()
    );
    assert_eq!(
        rolled.previous(),
        BillingPeriod {
            start: end,
            end: rolled.start
        }
    );
    assert!(rolled.previous().has_ended(later));
    assert!(!rolled.has_ended(later));
}

#[test]
fn billing_period_falls_back_to_the_calendar_month() {
    let now = Utc.with_ymd_and_hms(2026, 9, 10, 12, 0, 0).unwrap();
    let period = BillingPeriod::current(None, now);
    assert_eq!(
        period.start,
        Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap()
    );
    assert_eq!(
        period.end,
        Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap()
    );
    // An inverted anchor is ignored.
    assert_eq!(
        BillingPeriod::current(Some((period.end, period.start)), now),
        period
    );
}

#[test]
fn billing_period_covering_needs_an_anchor_that_contains_now() {
    let start = Utc.with_ymd_and_hms(2026, 4, 10, 0, 0, 0).unwrap();
    let end = Utc.with_ymd_and_hms(2026, 5, 10, 0, 0, 0).unwrap();
    let inside = Utc.with_ymd_and_hms(2026, 4, 18, 12, 0, 0).unwrap();

    assert_eq!(
        BillingPeriod::covering(Some((start, end)), inside),
        Some(BillingPeriod { start, end })
    );
    assert_eq!(
        BillingPeriod::covering(Some((start, end)), start),
        Some(BillingPeriod { start, end }),
        "the start is inclusive"
    );
    assert_eq!(BillingPeriod::covering(None, inside), None, "missing");
    assert_eq!(
        BillingPeriod::covering(Some((start, end)), end),
        None,
        "ended: the end is exclusive"
    );
    assert_eq!(
        BillingPeriod::covering(
            Some((start, end)),
            Utc.with_ymd_and_hms(2026, 4, 1, 0, 0, 0).unwrap()
        ),
        None,
        "future"
    );
    assert_eq!(
        BillingPeriod::covering(Some((end, start)), inside),
        None,
        "inverted"
    );
}

#[test]
fn billing_period_adopted_starts_at_the_stored_end_and_contains_now() {
    let subscription = BillingPeriod {
        start: Utc.with_ymd_and_hms(2026, 2, 3, 0, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 3, 3, 0, 0, 0).unwrap(),
    };
    let now = Utc.with_ymd_and_hms(2026, 2, 20, 12, 0, 0).unwrap();

    assert_eq!(
        subscription.adopted(None, now),
        Some(BillingPeriod {
            start: Utc.with_ymd_and_hms(2026, 2, 3, 0, 0, 0).unwrap(),
            end: Utc.with_ymd_and_hms(2026, 3, 3, 0, 0, 0).unwrap(),
        }),
        "no anchor"
    );
    assert_eq!(
        subscription.adopted(
            Some((
                Utc.with_ymd_and_hms(2026, 1, 15, 0, 0, 0).unwrap(),
                Utc.with_ymd_and_hms(2026, 2, 15, 0, 0, 0).unwrap(),
            )),
            now
        ),
        Some(BillingPeriod {
            start: Utc.with_ymd_and_hms(2026, 2, 15, 0, 0, 0).unwrap(),
            end: Utc.with_ymd_and_hms(2026, 3, 3, 0, 0, 0).unwrap(),
        }),
        "overlapping anchor"
    );
    assert_eq!(
        subscription.adopted(None, Utc.with_ymd_and_hms(2026, 3, 10, 0, 0, 0).unwrap()),
        None,
        "ended before now"
    );
}

#[test]
fn plan_tier_from_roles_prefers_max() {
    use roles_and_permissions::domain::model::RoleId;
    use std::collections::HashSet;

    let mut roles = HashSet::from([RoleId::ProfessionalSubscriber, RoleId::SubOpus]);
    assert_eq!(PlanTier::from_roles(&roles), PlanTier::Premium);
    roles.insert(RoleId::SubMax);
    assert_eq!(PlanTier::from_roles(&roles), PlanTier::Max);
    assert_eq!(
        PlanTier::from_roles(&HashSet::from([RoleId::SelfServe])),
        PlanTier::Free
    );
    assert_eq!(
        PlanTier::from_roles(&HashSet::from([RoleId::TeamSubscriber])),
        PlanTier::Premium
    );
}
