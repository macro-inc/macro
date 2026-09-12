//! The settlement arithmetic, kept pure so the repository can run it inside
//! its row lock and the service can run it for snapshots.
//!
//! For a payer and period, with everything in list-rate cents:
//!
//! ```text
//! covered   = included + credits_consumed + overage_charged
//! uncovered = max(0, used - covered)
//! headroom  = (covered - used) + credit_balance + overage_room
//! ```
//!
//! Settlement moves `uncovered` into `credits_consumed` (from the balance) and
//! then into `overage_charged` (when overage is on, within the cap, and the
//! chunk is worth charging). Between settlements `uncovered` is simply usage
//! that has not been booked yet; the gate accounts for it through `headroom`.

#[cfg(test)]
mod test;

use super::models::{
    AllowanceDecision, BillingPeriod, BillingSettings, DenyReason, Entitlement,
    MIN_STRIPE_CHARGE_CENTS, PeriodLedger, PlanTier, UsageSnapshot,
};
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
    /// Usage this period.
    pub used_cents: i64,
    /// Included this period.
    pub included_cents: i64,
    /// Credits already applied this period.
    pub credits_consumed_cents: i64,
    /// Overage already charged this period (pending or paid).
    pub overage_charged_cents: i64,
    /// Current credit balance.
    pub credit_balance_cents: i64,
}

impl SettlementState {
    /// Usage not yet covered by allowance, credits, or charges.
    pub fn uncovered_cents(&self) -> i64 {
        (self.used_cents
            - (self.included_cents + self.credits_consumed_cents + self.overage_charged_cents))
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

/// Assemble the API-facing snapshot from the resolved inputs.
pub fn build_snapshot(
    user: &MacroUserIdStr<'_>,
    entitlement: &Entitlement,
    settings: &BillingSettings,
    period: BillingPeriod,
    used_cents: i64,
    ledger: PeriodLedger,
    credit_balance_cents: i64,
) -> UsageSnapshot {
    let included_cents = entitlement.included_ai_cents();
    let covered = included_cents + ledger.credits_consumed_cents + ledger.overage_charged_cents;
    let uncovered_cents = (used_cents - covered).max(0);
    let overage_room = if settings.overage_active() {
        (settings.overage_limit_cents - ledger.overage_charged_cents).max(0)
    } else {
        0
    };
    let remaining_cents = if entitlement.unlimited {
        i64::MAX
    } else {
        ((covered - used_cents) + credit_balance_cents.max(0) + overage_room).max(0)
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
        used_cents,
        credits_consumed_cents: ledger.credits_consumed_cents,
        credit_balance_cents,
        overage_enabled: settings.overage_enabled,
        overage_limit_cents: settings.overage_limit_cents,
        overage_charged_cents: ledger.overage_charged_cents,
        overage_suspended: settings.overage_suspended_at.is_some(),
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
/// Free users are not metered here (the free tier has its own limits), and
/// enterprise users are never metered. Everyone else needs headroom.
pub fn decide(snapshot: &UsageSnapshot) -> AllowanceDecision {
    if snapshot.unlimited || snapshot.tier == PlanTier::Free || snapshot.remaining_cents > 0 {
        return AllowanceDecision::Allow;
    }
    let reason = if snapshot.overage_suspended {
        DenyReason::OveragePaymentFailed
    } else if snapshot.overage_enabled && snapshot.overage_limit_cents > 0 {
        DenyReason::OverageLimitReached
    } else {
        DenyReason::AllowanceExhausted
    };
    AllowanceDecision::Deny(reason)
}
