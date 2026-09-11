use super::*;
use crate::domain::models::{OVERAGE_CHARGE_THRESHOLD_CENTS, PayerScope, list_rate_cents};
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

fn state(used: i64, included: i64, consumed: i64, charged: i64, balance: i64) -> SettlementState {
    SettlementState {
        used_cents: used,
        included_cents: included,
        credits_consumed_cents: consumed,
        overage_charged_cents: charged,
        credit_balance_cents: balance,
    }
}

#[test]
fn list_rate_marks_provider_cost_up_to_the_target_margin() {
    // $16 of provider cost is exactly the Premium allowance at 60% margin.
    assert_eq!(list_rate_cents(16.0), 4_000);
    assert_eq!(list_rate_cents(80.0), 20_000);
    // Fractions of a cent round up.
    assert_eq!(list_rate_cents(0.001), 1);
    assert_eq!(list_rate_cents(0.0), 0);
    assert_eq!(list_rate_cents(-3.0), 0);
    assert_eq!(list_rate_cents(f64::NAN), 0);
}

#[test]
fn included_allowance_equals_plan_price_per_seat() {
    assert_eq!(PlanTier::Premium.included_ai_cents_per_seat(), 4_000);
    assert_eq!(PlanTier::Max.included_ai_cents_per_seat(), 20_000);
    assert_eq!(PlanTier::Free.included_ai_cents_per_seat(), 0);

    let mut team = Entitlement::personal(user("owner@x.com"), PlanTier::Premium);
    team.billed_users.push(user("a@x.com"));
    team.seat_tiers.push(PlanTier::Premium);
    team.billed_users.push(user("b@x.com"));
    team.seat_tiers.push(PlanTier::Premium);
    team.scope = PayerScope::TeamOwner {
        team_id: macro_uuid::generate_uuid_v7(),
    };
    assert_eq!(team.seats(), 3);
    assert_eq!(team.included_ai_cents(), 12_000);
}

#[test]
fn mixed_seat_plans_pool_each_seats_allowance() {
    // A Premium owner with one Max teammate and one Premium teammate: the
    // pool is $40 + $200 + $40, whatever plan the requesting user is on.
    let mut team = Entitlement::personal(user("owner@x.com"), PlanTier::Premium);
    team.billed_users.push(user("a@x.com"));
    team.seat_tiers.push(PlanTier::Max);
    team.billed_users.push(user("b@x.com"));
    team.seat_tiers.push(PlanTier::Premium);
    team.scope = PayerScope::TeamOwner {
        team_id: macro_uuid::generate_uuid_v7(),
    };
    assert_eq!(team.seats(), 3);
    assert_eq!(team.included_ai_cents(), 28_000);
    assert_eq!(team.tier, PlanTier::Premium);
}

#[test]
fn nothing_to_settle_under_allowance() {
    let plan = plan_settlement(state(3_000, 4_000, 0, 0, 5_000), policy(true, 5_000, false));
    assert_eq!(plan, SettlementPlan::default());
}

#[test]
fn credits_cover_overflow_before_overage() {
    let plan = plan_settlement(state(4_700, 4_000, 0, 0, 5_000), policy(true, 5_000, false));
    assert_eq!(plan.consume_credits_cents, 700);
    assert_eq!(plan.charge_overage_cents, 0);
}

#[test]
fn already_consumed_credits_are_not_double_counted() {
    // 700 over, 700 already consumed: settled.
    let plan = plan_settlement(
        state(4_700, 4_000, 700, 0, 4_300),
        policy(true, 5_000, false),
    );
    assert_eq!(plan, SettlementPlan::default());
}

#[test]
fn overage_waits_for_the_charge_threshold() {
    // 900 uncovered, no credits: below the $10 chunk, nothing charged yet.
    let plan = plan_settlement(state(4_900, 4_000, 0, 0, 0), policy(true, 5_000, false));
    assert_eq!(plan.charge_overage_cents, 0);
    // 1_000 uncovered: charged.
    let plan = plan_settlement(state(5_000, 4_000, 0, 0, 0), policy(true, 5_000, false));
    assert_eq!(plan.charge_overage_cents, 1_000);
}

#[test]
fn period_end_flushes_small_remainders_above_the_stripe_minimum() {
    let plan = plan_settlement(state(4_300, 4_000, 0, 0, 0), policy(true, 5_000, true));
    assert_eq!(plan.charge_overage_cents, 300);
    // Below Stripe's $0.50 floor the remainder is forgiven.
    let plan = plan_settlement(state(4_030, 4_000, 0, 0, 0), policy(true, 5_000, true));
    assert_eq!(plan.charge_overage_cents, 0);
}

#[test]
fn overage_respects_the_cap_and_prior_charges() {
    // 6_000 uncovered, cap 5_000 with 4_500 already charged: only 500 room,
    // and 500 is below the threshold mid-period.
    let plan = plan_settlement(
        state(14_500, 4_000, 0, 4_500, 0),
        policy(true, 5_000, false),
    );
    assert_eq!(plan.charge_overage_cents, 0);
    // At period end the 500 is flushed.
    let plan = plan_settlement(state(14_500, 4_000, 0, 4_500, 0), policy(true, 5_000, true));
    assert_eq!(plan.charge_overage_cents, 500);
}

#[test]
fn overage_off_only_consumes_credits() {
    let plan = plan_settlement(state(9_000, 4_000, 0, 0, 2_000), policy(false, 0, false));
    assert_eq!(plan.consume_credits_cents, 2_000);
    assert_eq!(plan.charge_overage_cents, 0);
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
    build_snapshot(&u, &ent, &settings, period, used, ledger, balance)
}

#[test]
fn gate_allows_within_allowance_and_blocks_after() {
    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        3_999,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(s.remaining_cents, 1);
    assert_eq!(decide(&s), AllowanceDecision::Allow);

    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        4_000,
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
    // 500 over allowance, not yet settled, 300 of credit: 300 - 500 < 0.
    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        4_500,
        PeriodLedger::default(),
        300,
    );
    assert_eq!(s.uncovered_cents, 500);
    assert_eq!(s.remaining_cents, 0);
    assert_eq!(
        decide(&s),
        AllowanceDecision::Deny(DenyReason::AllowanceExhausted)
    );

    // Once settled (500 consumed), the balance is what remains.
    let s = snapshot_for(
        PlanTier::Premium,
        BillingSettings::default(),
        4_500,
        PeriodLedger {
            credits_consumed_cents: 500,
            overage_charged_cents: 0,
        },
        800,
    );
    assert_eq!(s.uncovered_cents, 0);
    assert_eq!(s.remaining_cents, 800);
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
        5_500,
        PeriodLedger::default(),
        0,
    );
    // 1_500 uncovered against 2_000 of room.
    assert_eq!(s.remaining_cents, 500);
    assert_eq!(decide(&s), AllowanceDecision::Allow);

    let s = snapshot_for(
        PlanTier::Premium,
        settings,
        6_000,
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
        4_500,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(
        decide(&s),
        AllowanceDecision::Deny(DenyReason::OveragePaymentFailed)
    );
}

#[test]
fn free_and_unlimited_are_never_blocked() {
    let s = snapshot_for(
        PlanTier::Free,
        BillingSettings::default(),
        99_999,
        PeriodLedger::default(),
        0,
    );
    assert_eq!(decide(&s), AllowanceDecision::Allow);

    let u = user("ent@x.com");
    let mut ent = Entitlement::personal(u.clone(), PlanTier::Premium);
    ent.unlimited = true;
    let s = build_snapshot(
        &u,
        &ent,
        &BillingSettings::default(),
        BillingPeriod::calendar_month(Utc::now()),
        99_999,
        PeriodLedger::default(),
        0,
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
        PeriodLedger::default(),
        0,
    );
    assert!(!s.can_manage_billing);
    assert_eq!(s.seats, 2);
    assert_eq!(s.included_cents, 40_000);
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
