//! The settlement arithmetic, kept pure so the repository can run it inside
//! its row lock and the service can run it for snapshots.
//!
//! For a payer and period, each seat first consumes only its own included
//! allowance, both measured in cost cents. The remaining usage is chargeable to
//! the payer's shared credits and overage at the markup, in customer cents:
//!
//! ```text
//! chargeable_cost = sum(max(0, seat_used_cost - seat_included_cost))
//! chargeable      = extra_customer_cents(chargeable_cost)
//! covered         = credits_consumed + overage_charged
//! uncovered       = max(0, chargeable - covered)
//! headroom        = (covered - chargeable) + credit_balance + overage_room
//! remaining       = seat_remaining_cost + cost_cents_covered_by(headroom)
//! effective       = credit_balance - uncovered
//! reload          = min(target - effective, monthly_limit - reloaded_this_month)
//!                   when effective < minimum
//! ```
//!
//! The markup is applied to the period's cumulative chargeable cost, never to
//! an increment, so settling in several chunks books exactly the same money as
//! settling once. Settlement moves `uncovered` into `credits_consumed` (from
//! the balance) and then into `overage_charged` (when overage is on, within the
//! cap, and the chunk is worth charging). Between settlements `uncovered` is
//! simply usage that has not been booked yet; the gate accounts for it through
//! `headroom`.
//!
//! When automatic reloads are on, the current period is checked before
//! settlement: `effective` is what the balance will be once this settlement
//! consumes credits, and a reload tops it back up to `target` (within the
//! calendar-month limit) so credits, not overage, pay for the usage.
//!
//! Free users have no credits or overage: their `remaining` is only the
//! unused part of the free allowance, and nothing is ever settled for them.

#[cfg(test)]
mod test;

use super::models::{
    AllowanceDecision, AutoReloadSnapshot, AutoReloadThresholds, BillingPeriod, BillingSettings,
    DenyReason, Entitlement, MIN_STRIPE_CHARGE_CENTS, PeriodLedger, PlanTier, UsageSnapshot,
};
use super::pricing::AiPricing;
use macro_user_id::user_id::MacroUserIdStr;

/// The overage policy in force for one settlement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettlementPolicy {
    /// Whether overage may be charged at all.
    pub overage_active: bool,
    /// Per-period overage cap.
    pub overage_limit_cents: i64,
    /// Charge accrued overage once it reaches this.
    pub charge_threshold_cents: i64,
    /// The period is over: flush any chargeable remainder.
    pub period_ended: bool,
}

/// The ledger position a settlement plans against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettlementState {
    /// The period's cumulative usage beyond each seat's own allowance, already
    /// converted to customer cents at the overage markup.
    pub chargeable_customer_cents: i64,
    /// Credits already applied this period, customer cents.
    pub credits_consumed_cents: i64,
    /// Overage already charged this period (pending or paid), customer cents.
    pub overage_charged_cents: i64,
    /// Current credit balance, customer cents.
    pub credit_balance_cents: i64,
}

impl SettlementState {
    /// Chargeable money not yet covered by credits or charges.
    pub fn uncovered_cents(&self) -> i64 {
        (self.chargeable_customer_cents
            - (self.credits_consumed_cents + self.overage_charged_cents))
            .max(0)
    }
}

/// What a settlement should book.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SettlementPlan {
    /// Credits to consume against the period.
    pub consume_credits_cents: i64,
    /// Overage to charge now (0 when nothing is chargeable yet).
    pub charge_overage_cents: i64,
}

/// Decide how much of the uncovered usage to book from credits and how much
/// to charge as overage.
pub fn plan_settlement(state: SettlementState, policy: SettlementPolicy) -> SettlementPlan {
    let uncovered = state.uncovered_cents();
    if uncovered == 0 {
        return SettlementPlan::default();
    }

    let consume = uncovered.min(state.credit_balance_cents.max(0));
    let rest = uncovered - consume;

    let charge = if policy.overage_active && rest > 0 {
        let room = (policy.overage_limit_cents - state.overage_charged_cents).max(0);
        let chargeable = rest.min(room);
        let worth_charging = chargeable >= policy.charge_threshold_cents
            || (policy.period_ended && chargeable >= MIN_STRIPE_CHARGE_CENTS);
        if worth_charging { chargeable } else { 0 }
    } else {
        0
    };

    SettlementPlan {
        consume_credits_cents: consume,
        charge_overage_cents: charge,
    }
}

/// The balance position an automatic reload plans against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReloadState {
    /// Current credit balance, customer cents.
    pub credit_balance_cents: i64,
    /// Current-period chargeable money not yet covered by credits or charges,
    /// customer cents. The settlement that follows will consume it from the
    /// balance.
    pub uncovered_cents: i64,
    /// Reloads already reserved or paid this UTC calendar month, customer cents.
    pub spent_this_month_cents: i64,
}

/// Decide whether to reload credits now and by how much.
///
/// Reloads when the balance left after settling the uncovered usage drops
/// below the minimum, topping it back up to the target. The monthly limit caps
/// the amount; a remainder Stripe would reject is skipped rather than charged.
pub fn plan_reload(state: ReloadState, thresholds: &AutoReloadThresholds) -> Option<i64> {
    let effective = state.credit_balance_cents - state.uncovered_cents;
    if effective >= thresholds.minimum_cents {
        return None;
    }

    let mut amount = thresholds.target_cents - effective;
    if let Some(limit) = thresholds.monthly_limit_cents {
        let room = (limit - state.spent_this_month_cents).max(0);
        amount = amount.min(room);
    }

    (amount >= MIN_STRIPE_CHARGE_CENTS).then_some(amount)
}

/// Assemble the API-facing snapshot from the resolved inputs. `used_cost_cents`
/// is this seat's usage at cost; `shared_chargeable_customer_cents` is the
/// payer's cumulative usage beyond all seat allowances, already marked up at
/// `pricing`.
#[expect(
    clippy::too_many_arguments,
    reason = "snapshot assembly keeps its resolved billing inputs explicit"
)]
pub fn build_snapshot(
    user: &MacroUserIdStr<'_>,
    entitlement: &Entitlement,
    settings: &BillingSettings,
    period: BillingPeriod,
    used_cost_cents: i64,
    shared_chargeable_customer_cents: i64,
    ledger: PeriodLedger,
    credit_balance_cents: i64,
    pricing: AiPricing,
) -> UsageSnapshot {
    let included_cents = entitlement.included_ai_cents(pricing);
    let shared_covered = ledger.credits_consumed_cents + ledger.overage_charged_cents;
    let uncovered_cents = (shared_chargeable_customer_cents - shared_covered).max(0);
    let overage_room = if settings.overage_active() {
        (settings.overage_limit_cents - ledger.overage_charged_cents).max(0)
    } else {
        0
    };
    let seat_remaining = (included_cents - used_cost_cents).max(0);
    let remaining_cents = if entitlement.unlimited {
        i64::MAX
    } else if !entitlement.tier.is_paid() {
        // A hard cap: no credits or overage can extend the free allowance.
        seat_remaining
    } else {
        let shared_headroom = ((shared_covered - shared_chargeable_customer_cents)
            + credit_balance_cents.max(0)
            + overage_room)
            .max(0);
        seat_remaining.saturating_add(pricing.cost_cents_covered_by(shared_headroom))
    };

    let mut snapshot = UsageSnapshot {
        tier: entitlement.tier,
        unlimited: entitlement.unlimited,
        payer: entitlement.payer.clone(),
        can_manage_billing: entitlement.is_payer(user),
        seats: entitlement.seats(),
        period_start: period.start,
        period_end: period.end,
        included_cents,
        used_cents: used_cost_cents,
        credits_consumed_cents: ledger.credits_consumed_cents,
        credit_balance_cents,
        overage_enabled: settings.overage_enabled,
        overage_limit_cents: settings.overage_limit_cents,
        overage_charged_cents: ledger.overage_charged_cents,
        overage_suspended: settings.overage_suspended_at.is_some(),
        auto_reload: AutoReloadSnapshot {
            minimum_balance_cents: settings.auto_reload.minimum_cents,
            target_balance_cents: settings.auto_reload.target_cents,
            monthly_spend_limit_cents: settings.auto_reload.monthly_limit_cents,
            suspended: settings.auto_reload_suspended_at.is_some(),
            active: settings.auto_reload_active(),
        },
        uncovered_cents,
        remaining_cents,
        blocked_reason: None,
    };
    snapshot.blocked_reason = match decide(&snapshot) {
        AllowanceDecision::Allow => None,
        AllowanceDecision::Deny(reason) => Some(reason),
    };
    snapshot
}

/// The gate: may this user start another AI request?
///
/// Enterprise users are never metered. Free users are allowed until their
/// monthly cap is used up, after which only an upgrade helps. Everyone else
/// needs headroom from their allowance, credits, or overage.
pub fn decide(snapshot: &UsageSnapshot) -> AllowanceDecision {
    if snapshot.unlimited || snapshot.remaining_cents > 0 {
        return AllowanceDecision::Allow;
    }
    let reason = if snapshot.tier == PlanTier::Free {
        DenyReason::FreeAllowanceExhausted
    } else if snapshot.overage_suspended {
        DenyReason::OveragePaymentFailed
    } else if snapshot.overage_enabled && snapshot.overage_limit_cents > 0 {
        DenyReason::OverageLimitReached
    } else {
        DenyReason::AllowanceExhausted
    };
    AllowanceDecision::Deny(reason)
}
