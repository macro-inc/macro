//! Plans, the margin math, billing periods, and the API-facing snapshot.

use chrono::{DateTime, Datelike, Months, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use roles_and_permissions::domain::model::RoleId;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;
use utoipa::ToSchema;

/// Target gross margin on AI, in basis points. The list rate is provider cost
/// divided by `(1 - margin)`; at 60% that is a 2.5x markup.
pub const TARGET_GROSS_MARGIN_BPS: i64 = 6_000;

const BPS_PER_UNIT: i64 = 10_000;

/// Convert a provider cost in USD to Macro's list rate in whole cents,
/// rounding up so fractional cents never accrue in the customer's favour.
pub fn list_rate_cents(provider_cost_usd: f64) -> i64 {
    if !provider_cost_usd.is_finite() || provider_cost_usd <= 0.0 {
        return 0;
    }
    let markup = BPS_PER_UNIT as f64 / (BPS_PER_UNIT - TARGET_GROSS_MARGIN_BPS) as f64;
    (provider_cost_usd * 100.0 * markup).ceil() as i64
}

/// One-off credit packs a payer may buy, in list-rate cents.
pub const CREDIT_PACKS_CENTS: [i64; 4] = [1_000, 2_500, 5_000, 10_000];

/// Smallest per-period overage cap a payer may set.
pub const OVERAGE_LIMIT_MIN_CENTS: i64 = 500;
/// Largest per-period overage cap a payer may set.
pub const OVERAGE_LIMIT_MAX_CENTS: i64 = 500_000;
/// Accrued overage is charged once it reaches this much (or when the period
/// ends), so a payer sees a few predictable charges rather than one per
/// completion.
pub const OVERAGE_CHARGE_THRESHOLD_CENTS: i64 = 1_000;
/// Stripe rejects charges under $0.50; a smaller period-end remainder is
/// forgiven rather than retried forever.
pub const MIN_STRIPE_CHARGE_CENTS: i64 = 50;

/// The plans a user can be on, cheapest first.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PlanTier {
    /// No subscription. AI on the free model only; metered elsewhere.
    Free,
    /// The $40/seat/month plan (recorded as the legacy `sub_opus` role).
    Premium,
    /// The $200/seat/month plan with a 5x AI allowance.
    Max,
}

impl PlanTier {
    /// Monthly list price per seat, in cents.
    pub const fn monthly_price_cents(self) -> i64 {
        match self {
            PlanTier::Free => 0,
            PlanTier::Premium => 4_000,
            PlanTier::Max => 20_000,
        }
    }

    /// AI usage included per seat per period, in list-rate cents. Equal to the
    /// plan price by construction: spending it all costs Macro
    /// `price x (1 - margin)`, which is exactly the target margin.
    pub const fn included_ai_cents_per_seat(self) -> i64 {
        self.monthly_price_cents()
    }

    /// Whether this tier pays for AI at all (credits and overage need a plan).
    pub const fn is_paid(self) -> bool {
        !matches!(self, PlanTier::Free)
    }

    /// Derive the tier from a user's roles. `sub_max` wins over every other
    /// paid role; any other paid subscription role is Premium.
    pub fn from_roles(roles: &HashSet<RoleId>) -> Self {
        if roles.contains(&RoleId::SubMax) {
            PlanTier::Max
        } else if roles.iter().any(RoleId::is_paid_subscription) {
            PlanTier::Premium
        } else {
            PlanTier::Free
        }
    }
}

/// A half-open `[start, end)` window that usage is metered against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BillingPeriod {
    /// Inclusive start.
    pub start: DateTime<Utc>,
    /// Exclusive end.
    pub end: DateTime<Utc>,
}

impl BillingPeriod {
    /// The period containing `now`.
    ///
    /// With a Stripe anchor (the subscription's most recently synced
    /// `current_period_start/end`) the window is the anchor itself, rolled
    /// forward by its own length in months when the webhook that would have
    /// moved it has not landed yet. Without an anchor, the UTC calendar month.
    pub fn current(anchor: Option<(DateTime<Utc>, DateTime<Utc>)>, now: DateTime<Utc>) -> Self {
        if let Some((start, end)) = anchor
            && start < end
        {
            if now < end {
                return Self { start, end };
            }
            let anchor_days = (end - start).num_days().max(1) as f64;
            let months_per_period = (anchor_days / 30.44).round().max(1.0) as u32;
            let mut index = 1u32;
            // A stale anchor is at most a few periods old; cap the walk so a
            // pathological anchor can never spin.
            while index <= 1_200 {
                let candidate = start
                    .checked_add_months(Months::new(index * months_per_period))
                    .zip(start.checked_add_months(Months::new((index + 1) * months_per_period)));
                match candidate {
                    Some((s, e)) if now < e => return Self { start: s, end: e },
                    Some(_) => index += 1,
                    None => break,
                }
            }
        }
        Self::calendar_month(now)
    }

    /// The period immediately before this one, assuming the same length in
    /// whole months (one month for calendar periods).
    pub fn previous(&self) -> Self {
        let anchor_days = (self.end - self.start).num_days().max(1) as f64;
        let months = Months::new((anchor_days / 30.44).round().max(1.0) as u32);
        let start = self.start.checked_sub_months(months).unwrap_or(self.start);
        Self {
            start,
            end: self.start,
        }
    }

    /// The UTC calendar month containing `now`.
    pub fn calendar_month(now: DateTime<Utc>) -> Self {
        let start = Utc
            .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
            .single()
            .unwrap_or(now);
        let end = start.checked_add_months(Months::new(1)).unwrap_or(start);
        Self { start, end }
    }

    /// Whether `now` is at or past the end of this period.
    pub fn has_ended(&self, now: DateTime<Utc>) -> bool {
        now >= self.end
    }
}

/// Who pays for a user's AI, and through what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayerScope {
    /// A personal subscription (or no subscription).
    Personal,
    /// The user owns a paying team; members' usage pools onto their account.
    TeamOwner {
        /// The team.
        team_id: Uuid,
    },
    /// The user's paid access comes through a team; the owner pays.
    TeamMember {
        /// The team.
        team_id: Uuid,
    },
}

/// A user's resolved plan and payer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entitlement {
    /// The plan the user is on.
    pub tier: PlanTier,
    /// Enterprise teams are billed out of band and never metered.
    pub unlimited: bool,
    /// The account that owns credits, overage settings, and the Stripe
    /// customer. The user themself unless they are a team member.
    pub payer: MacroUserIdStr<'static>,
    /// Every user whose usage counts against the payer's pooled allowance.
    /// Contains at least the payer.
    pub billed_users: Vec<MacroUserIdStr<'static>>,
    /// How the payer relates to the user.
    pub scope: PayerScope,
}

impl Entitlement {
    /// A user with no team, paying (or not) for themself.
    pub fn personal(user: MacroUserIdStr<'static>, tier: PlanTier) -> Self {
        Self {
            tier,
            unlimited: false,
            payer: user.clone(),
            billed_users: vec![user],
            scope: PayerScope::Personal,
        }
    }

    /// Seats billed to the payer.
    pub fn seats(&self) -> u32 {
        self.billed_users.len().max(1) as u32
    }

    /// Included AI per period across all seats, in list-rate cents.
    pub fn included_ai_cents(&self) -> i64 {
        self.tier.included_ai_cents_per_seat() * i64::from(self.seats())
    }

    /// Whether `user` is the payer (and may change billing settings).
    pub fn is_payer(&self, user: &MacroUserIdStr<'_>) -> bool {
        self.payer.as_ref() == user.as_ref()
    }
}

/// The payer's overage settings and Stripe period anchor.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BillingSettings {
    /// Whether usage past allowance and credits is billed as overage.
    pub overage_enabled: bool,
    /// Per-period cap on overage, in list-rate cents.
    pub overage_limit_cents: i64,
    /// Set when an overage charge failed to collect.
    pub overage_suspended_at: Option<DateTime<Utc>>,
    /// The subscription period last synced from Stripe.
    pub period_anchor: Option<(DateTime<Utc>, DateTime<Utc>)>,
}

impl BillingSettings {
    /// Whether overage can currently be charged.
    pub fn overage_active(&self) -> bool {
        self.overage_enabled && self.overage_suspended_at.is_none() && self.overage_limit_cents > 0
    }
}

/// What has already been settled against a period.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PeriodLedger {
    /// Credits applied to this period's usage, in cents (positive).
    pub credits_consumed_cents: i64,
    /// Overage charged (pending or paid) for this period, in cents.
    pub overage_charged_cents: i64,
}

/// Lifecycle of an overage charge pushed to Stripe.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum OverageChargeStatus {
    /// Reserved in the ledger; Stripe not yet confirmed.
    Pending,
    /// Collected.
    Paid,
    /// Collection failed; does not cover usage and suspends overage.
    Failed,
}

/// Why a request was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum DenyReason {
    /// The plan's included AI is used up and no credits or overage remain.
    AllowanceExhausted,
    /// Overage is on but the payer's per-period cap has been reached.
    OverageLimitReached,
    /// An overage charge failed; overage is paused until the payer re-enables it.
    OveragePaymentFailed,
}

impl DenyReason {
    /// A stable machine-readable code for API error bodies.
    pub fn code(self) -> &'static str {
        match self {
            DenyReason::AllowanceExhausted => "ai_allowance_exhausted",
            DenyReason::OverageLimitReached => "ai_overage_limit_reached",
            DenyReason::OveragePaymentFailed => "ai_overage_payment_failed",
        }
    }

    /// A short human-readable explanation.
    pub fn message(self) -> &'static str {
        match self {
            DenyReason::AllowanceExhausted => {
                "You've used this period's included AI. Add credits, turn on usage billing, or upgrade to keep going."
            }
            DenyReason::OverageLimitReached => {
                "You've reached your AI spending limit for this period. Raise the limit or add credits to keep going."
            }
            DenyReason::OveragePaymentFailed => {
                "Your last AI usage charge didn't go through. Update your payment method and re-enable usage billing."
            }
        }
    }
}

/// The gate's verdict for one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllowanceDecision {
    /// Proceed.
    Allow,
    /// Refuse, for the given reason.
    Deny(DenyReason),
}

/// The payer's current-period position, as shown in Billing settings and used
/// by the gate.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UsageSnapshot {
    /// The plan.
    pub tier: PlanTier,
    /// Enterprise: never metered.
    pub unlimited: bool,
    /// The payer for this user's AI.
    #[schema(value_type = String)]
    pub payer: MacroUserIdStr<'static>,
    /// Whether the requesting user is the payer.
    pub can_manage_billing: bool,
    /// Seats pooled onto the payer.
    pub seats: u32,
    /// Period start.
    pub period_start: DateTime<Utc>,
    /// Period end (exclusive).
    pub period_end: DateTime<Utc>,
    /// Included AI this period across all seats, list-rate cents.
    pub included_cents: i64,
    /// AI used this period across all seats, list-rate cents.
    pub used_cents: i64,
    /// Credits already applied to this period.
    pub credits_consumed_cents: i64,
    /// Prepaid credit balance.
    pub credit_balance_cents: i64,
    /// Whether overage billing is on.
    pub overage_enabled: bool,
    /// Per-period overage cap.
    pub overage_limit_cents: i64,
    /// Overage charged so far this period.
    pub overage_charged_cents: i64,
    /// Whether overage is paused after a failed charge.
    pub overage_suspended: bool,
    /// Usage not yet covered by allowance, credits, or charges (awaiting
    /// settlement).
    pub uncovered_cents: i64,
    /// Headroom before AI requests are refused; 0 when blocked.
    pub remaining_cents: i64,
    /// Why requests are refused right now, if they are.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<DenyReason>,
}

/// Errors raised by the billing domain.
#[derive(Debug, Error)]
pub enum BillingError {
    /// Only the payer may change billing settings or buy credits.
    #[error("only the account that pays for this plan can change its billing")]
    NotPayer,
    /// Credits and overage need a paid plan.
    #[error("a paid plan is required")]
    FreePlan,
    /// Not one of [`CREDIT_PACKS_CENTS`].
    #[error("credit amount is not an offered pack")]
    InvalidCreditAmount,
    /// Outside the allowed overage cap range.
    #[error("overage limit must be between ${} and ${}", OVERAGE_LIMIT_MIN_CENTS / 100, OVERAGE_LIMIT_MAX_CENTS / 100)]
    InvalidOverageLimit,
    /// The payer has no Stripe customer to bill.
    #[error("no payment account on file")]
    NoStripeCustomer,
    /// The payment provider failed.
    #[error("payment provider error: {0}")]
    Payment(anyhow::Error),
    /// Storage failed.
    #[error("storage error: {0}")]
    Storage(anyhow::Error),
    /// Entitlement lookup failed.
    #[error("entitlement lookup failed: {0}")]
    Entitlement(anyhow::Error),
}

/// Convenience result alias for the crate.
pub type Result<T> = std::result::Result<T, BillingError>;
