//! Plans, billing periods, settings, and the API-facing snapshot.

#[cfg(test)]
mod test;

use super::pricing::AiPricing;
pub use ai_usage::NON_BILLABLE_AI_FEATURES;
use chrono::{DateTime, Datelike, Months, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use roles_and_permissions::domain::model::RoleId;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;
use utoipa::ToSchema;

/// Whether usage past a payer's allowance is settled: prepaid credits consumed
/// and automatic credit reloads collected through Stripe. Hosts load it from
/// `ENABLE_AI_USAGE_BILLING` at startup. It is independent of quota admission
/// ([`AiUsageEnforcement`](ai_usage::AiUsageEnforcement)) and of the deployment
/// environment.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum AiUsageBilling {
    /// Never consume credits, reserve overage, or collect payment.
    #[default]
    Disabled,
    /// Settle uncovered usage from credits, with optional automatic reloads.
    Enabled,
}

impl AiUsageBilling {
    /// Whether settlement is enabled.
    pub const fn is_enabled(self) -> bool {
        matches!(self, Self::Enabled)
    }
}

/// Persisted usage-policy identity, independent of purchase availability or today's roles.
/// A verified period activation selects this value; legacy records are never repriced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsagePolicy {
    /// Aggregate per-period settlement in [`super::ledger`]: the at-cost
    /// allowance, then prepaid credits at the markup.
    Legacy,
    /// Per-attempt exact-money policy in [`super::policy`]: the same allowance
    /// at public price, then public usage at the same markup.
    PublicAllowanceV1,
}

/// One-off credit packs a payer may buy, in customer cents.
pub const CREDIT_PACKS_CENTS: [i64; 4] = [1_000, 2_500, 5_000, 10_000];

/// Smallest per-period overage cap a payer may set.
pub const OVERAGE_LIMIT_MIN_CENTS: i64 = 500;
/// Largest per-period overage cap a payer may set.
pub const OVERAGE_LIMIT_MAX_CENTS: i64 = 500_000;
/// Credit balance below which an automatic reload fires, unless the payer
/// has set their own minimum.
pub const AUTO_RELOAD_DEFAULT_MINIMUM_CENTS: i64 = 1_000;
/// Credit balance an automatic reload tops up to, unless the payer has set
/// their own target.
pub const AUTO_RELOAD_DEFAULT_TARGET_CENTS: i64 = 10_000;
/// Largest automatic reload target a payer may set.
pub const AUTO_RELOAD_TARGET_MAX_CENTS: i64 = 500_000;
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
    /// No subscription. AI on the free model only, hard-capped at the
    /// configured free allowance each calendar month; no credits or overage.
    Free,
    /// The $40/seat/month plan (recorded as the legacy `sub_opus` role).
    Premium,
    /// The $200/seat/month plan, with its own configured AI allowance.
    Max,
}

impl PlanTier {
    /// Monthly subscription price per seat, in cents.
    pub const fn monthly_price_cents(self) -> i64 {
        match self {
            PlanTier::Free => 0,
            PlanTier::Premium => 4_000,
            PlanTier::Max => 20_000,
        }
    }

    /// AI usage included per seat per period, in cents at provider cost: this
    /// tier's configured allowance ([`AiPricing::included_allowance_cents_for`]).
    /// For Free this is the whole monthly cap.
    pub const fn included_ai_cents_per_seat(self, pricing: AiPricing) -> i64 {
        pricing.included_allowance_cents_for(self)
    }

    /// Whether this tier pays for AI beyond its allowance (credits and overage
    /// need a plan). Free is hard-capped at its allowance instead.
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

impl From<teams::domain::model::SeatPlan> for PlanTier {
    fn from(plan: teams::domain::model::SeatPlan) -> Self {
        match plan {
            teams::domain::model::SeatPlan::Premium => PlanTier::Premium,
            teams::domain::model::SeatPlan::Max => PlanTier::Max,
        }
    }
}

/// A half-open `[start, end)` window that usage is metered against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

    /// The stored anchor when it contains `now`.
    pub fn covering(
        anchor: Option<(DateTime<Utc>, DateTime<Utc>)>,
        now: DateTime<Utc>,
    ) -> Option<Self> {
        let (start, end) = anchor?;
        (start <= now && now < end).then_some(Self { start, end })
    }

    /// The part of this subscription window to store and meter after the
    /// stored anchor.
    ///
    /// The start moves up to the anchor's end because the store refuses a start
    /// that overlaps the stored window. `None` when that part does not contain
    /// `now`, because it is then not a period to meter.
    pub fn adopted(
        self,
        anchor: Option<(DateTime<Utc>, DateTime<Utc>)>,
        now: DateTime<Utc>,
    ) -> Option<Self> {
        let start = match anchor {
            Some((_, stored_end)) => self.start.max(stored_end),
            None => self.start,
        };
        Self::covering(Some((start, self.end)), now)
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

    /// `Some` while `now` is inside `[start, end)`.
    pub fn open_start(self, now: DateTime<Utc>) -> Option<OpenPeriodStart> {
        if self.has_ended(now) {
            None
        } else {
            Some(OpenPeriodStart(self.start))
        }
    }
}

/// Start of the period that contains `now`.
///
/// Closed periods cannot be named by this type, so open-period writers cannot
/// target them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenPeriodStart(DateTime<Utc>);

impl OpenPeriodStart {
    /// Inclusive start of the open period.
    pub const fn start(self) -> DateTime<Utc> {
        self.0
    }
}

/// Monotonic generation of a payer's open-seat roster.
///
/// A missing `ai_billing_account` row is generation zero. Releasing a seat
/// moves it forward so a roster read from before the release cannot be stored.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SeatGeneration(i64);

impl SeatGeneration {
    /// The generation stored in Postgres.
    pub const fn from_raw(raw: i64) -> Self {
        Self(raw)
    }

    /// The generation stored in Postgres.
    pub const fn raw(self) -> i64 {
        self.0
    }
}

/// Outcome of a conditional open-period allowance store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllowanceStore {
    /// The open-period row matches the supplied seats.
    Stored,
    /// `seat_generation` moved after it was observed. The arrays were not written.
    Conflict,
}

/// Which of the payer's subscriptions funds an overage charge.
///
/// A payer may hold a personal subscription and a team subscription at the
/// same time. Team owners and team members both use the team subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubscriptionScope {
    /// The subscription that is not tied to a team.
    Personal,
    /// The subscription for this team.
    Team {
        /// The team.
        team_id: Uuid,
    },
}

impl From<&PayerScope> for SubscriptionScope {
    fn from(scope: &PayerScope) -> Self {
        match scope {
            PayerScope::Personal => Self::Personal,
            PayerScope::TeamOwner { team_id } | PayerScope::TeamMember { team_id } => {
                Self::Team { team_id: *team_id }
            }
        }
    }
}

/// Who pays for a user's AI, and through what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayerScope {
    /// A personal subscription (or no subscription).
    Personal,
    /// The user owns a paying team and pays for members' shared credits and
    /// overage.
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

/// The included AI assigned to one billed seat for a period.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatAllowance {
    /// The user occupying the seat.
    pub user: MacroUserIdStr<'static>,
    /// Included AI for this seat, in cents at provider cost.
    pub included_cents: i64,
}

/// AI usage attributed to one billed seat in a period.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatUsage {
    /// The user occupying the seat.
    pub user: MacroUserIdStr<'static>,
    /// Usage in cents at provider cost.
    pub used_cents: i64,
}

/// A user's resolved plan and payer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entitlement {
    /// The plan the user's own seat is on.
    pub tier: PlanTier,
    /// The plan of every billed seat, in the same order as [`Self::billed_users`].
    /// A team may mix Premium and Max seats.
    pub seat_tiers: Vec<PlanTier>,
    /// Enterprise teams are billed out of band and never metered.
    pub unlimited: bool,
    /// The account that owns credits, overage settings, and the Stripe
    /// customer. The user themself unless they are a team member.
    pub payer: MacroUserIdStr<'static>,
    /// Every user whose usage can consume the payer's shared credits and
    /// overage. Contains at least the payer.
    pub billed_users: Vec<MacroUserIdStr<'static>>,
    /// How the payer relates to the user.
    pub scope: PayerScope,
}

impl Entitlement {
    /// A user with no team, paying (or not) for themself.
    pub fn personal(user: MacroUserIdStr<'static>, tier: PlanTier) -> Self {
        Self {
            tier,
            seat_tiers: vec![tier],
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

    /// Included AI for this user's seat, in cents at provider cost.
    pub fn included_ai_cents(&self, pricing: AiPricing) -> i64 {
        self.tier.included_ai_cents_per_seat(pricing)
    }

    /// Each billed seat with its own included AI. Unused allowance never moves
    /// between seats; only credits and overage are shared by the payer.
    pub fn seat_allowances(&self, pricing: AiPricing) -> Vec<SeatAllowance> {
        self.billed_users
            .iter()
            .enumerate()
            .map(|(index, user)| {
                let tier = self.seat_tiers.get(index).copied().unwrap_or(self.tier);
                SeatAllowance {
                    user: user.clone(),
                    included_cents: tier.included_ai_cents_per_seat(pricing),
                }
            })
            .collect()
    }

    /// Whether `user` is the payer (and may change billing settings).
    pub fn is_payer(&self, user: &MacroUserIdStr<'_>) -> bool {
        self.payer.as_ref() == user.as_ref()
    }

    /// Paid and finite: usage is metered against a subscription period.
    pub fn is_metered(&self) -> bool {
        self.tier.is_paid() && !self.unlimited
    }
}

/// When and how far a payer's credit balance is automatically reloaded.
///
/// The legacy `overage_enabled` storage field now controls only automatic reloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoReloadThresholds {
    /// Reload once the effective balance drops below this, in customer cents.
    pub minimum_cents: i64,
    /// Reload the balance back up to this, in customer cents.
    pub target_cents: i64,
    /// Most a payer will be reloaded per UTC calendar month, in customer
    /// cents. `None` means no limit.
    pub monthly_limit_cents: Option<i64>,
}

impl Default for AutoReloadThresholds {
    fn default() -> Self {
        Self {
            minimum_cents: AUTO_RELOAD_DEFAULT_MINIMUM_CENTS,
            target_cents: AUTO_RELOAD_DEFAULT_TARGET_CENTS,
            monthly_limit_cents: None,
        }
    }
}

impl AutoReloadThresholds {
    /// Reject thresholds that could never produce a chargeable reload or
    /// that exceed the offered range.
    pub fn validate(&self) -> Result<()> {
        if self.minimum_cents <= 0 {
            return Err(BillingError::InvalidAutoReload(
                "minimum balance must be positive",
            ));
        }
        if self.target_cents < self.minimum_cents + MIN_STRIPE_CHARGE_CENTS {
            return Err(BillingError::InvalidAutoReload(
                "target balance must be at least $0.50 above the minimum balance",
            ));
        }
        if self.target_cents > AUTO_RELOAD_TARGET_MAX_CENTS {
            return Err(BillingError::InvalidAutoReload(
                "target balance exceeds the largest offered reload",
            ));
        }
        // Keep the offered minimum monthly reload budget.
        if self
            .monthly_limit_cents
            .is_some_and(|limit| limit < OVERAGE_LIMIT_MIN_CENTS)
        {
            return Err(BillingError::InvalidAutoReload(
                "monthly spend limit must be at least $5",
            ));
        }
        Ok(())
    }
}

/// The payer's overage settings, Stripe period anchor, and open-seat generation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BillingSettings {
    /// Legacy storage name for the automatic reload opt-in. Never authorizes direct charges.
    pub overage_enabled: bool,
    /// Per-period cap on overage, in customer cents.
    pub overage_limit_cents: i64,
    /// Set when an overage charge failed to collect.
    pub overage_suspended_at: Option<DateTime<Utc>>,
    /// When and how far credits are automatically reloaded.
    pub auto_reload: AutoReloadThresholds,
    /// Set when an automatic reload failed to collect.
    pub auto_reload_suspended_at: Option<DateTime<Utc>>,
    /// The subscription period last observed from Stripe (webhook or read-through).
    pub period_anchor: Option<(DateTime<Utc>, DateTime<Utc>)>,
    /// Generation of the payer's open-seat roster. Zero when no account row exists.
    pub seat_generation: SeatGeneration,
}

impl BillingSettings {
    /// Direct usage charges are permanently disabled, regardless of stored legacy settings.
    pub fn overage_active(&self) -> bool {
        false
    }

    /// Whether credits are automatically reloaded: the payer opted in and no
    /// reload has failed since the payer last re-enabled it.
    pub fn auto_reload_active(&self) -> bool {
        self.overage_enabled && self.auto_reload_suspended_at.is_none()
    }
}

/// What has already been settled against a period.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PeriodLedger {
    /// Credits applied to this period's usage, in cents (positive).
    pub credits_consumed_cents: i64,
    /// Overage charged for this period, in cents. Includes pending and paid
    /// charges, plus failed charges whose Stripe invoice may still collect.
    pub overage_charged_cents: i64,
}

/// The allowance observed for a payer while a period was still open.
///
/// Closed-period settlement uses this instead of the live entitlement so a
/// later plan or seat change cannot skip last period's overage (upgrade) or
/// charge usage that was included (downgrade).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeriodAllowance {
    /// Included AI frozen for each seat in the period.
    pub seats: Vec<SeatAllowance>,
}

/// Lifecycle of an overage charge pushed to Stripe.
///
/// Both this and [`CreditReloadStatus`] follow the same rules, which
/// [`InvoiceOutcome`] maps provider reports onto:
///
/// - `Paid` and `Voided` are final.
/// - `Uncollectible` only moves to one of those: a late failure report cannot
///   revive a write-off.
/// - A row Stripe may still collect (`Pending`, `RequiresAction`, `Paid`, or
///   `Failed` with an invoice) keeps covering usage, counting against limits,
///   and blocking a duplicate. `Voided` and `Uncollectible` never do.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum OverageChargeStatus {
    /// Reserved in the ledger; Stripe not yet confirmed.
    Pending,
    /// The invoice is open but its payment needs the payer to authenticate on
    /// the Stripe-hosted invoice page. Overage is suspended until they do (or
    /// re-enable it, which retries this invoice with their current card).
    RequiresAction,
    /// Collected.
    Paid,
    /// Collection failed and overage is suspended. The charge stops covering
    /// usage only when no Stripe invoice was opened for it.
    Failed,
    /// Stripe voided the invoice. Final: it never collects and no longer
    /// covers usage.
    Voided,
    /// Stripe wrote the invoice off. It no longer collects automatically or
    /// covers usage; a late payment still reports it paid.
    Uncollectible,
}

impl OverageChargeStatus {
    /// Whether a provider report of `next` may replace this status.
    pub fn accepts(self, next: Self) -> bool {
        if self == next {
            return false;
        }
        match self {
            Self::Paid | Self::Voided => false,
            Self::Uncollectible => matches!(next, Self::Paid | Self::Voided),
            Self::Pending | Self::RequiresAction | Self::Failed => true,
        }
    }

    /// Whether Stripe may still collect this charge, so it keeps covering its
    /// usage. The Postgres adapter mirrors this predicate in SQL.
    pub fn may_collect(self, has_invoice: bool) -> bool {
        match self {
            Self::Pending | Self::RequiresAction | Self::Paid => true,
            Self::Failed => has_invoice,
            Self::Voided | Self::Uncollectible => false,
        }
    }

    /// Whether this outcome pauses overage until the payer acts.
    pub fn suspends(self) -> bool {
        matches!(
            self,
            Self::RequiresAction | Self::Failed | Self::Voided | Self::Uncollectible
        )
    }
}

/// Lifecycle of an automatic credit reload pushed to Stripe. Same rules as
/// [`OverageChargeStatus`].
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CreditReloadStatus {
    /// Reserved; Stripe not yet confirmed.
    Pending,
    /// The invoice is open but its payment needs the payer to authenticate on
    /// the Stripe-hosted invoice page. Reloads are suspended until they do
    /// (or save their settings again, which retries this invoice).
    RequiresAction,
    /// Collected and booked as credits.
    Paid,
    /// Collection failed and automatic reloads are suspended.
    Failed,
    /// Stripe voided the invoice. Final: it never collects and stops
    /// blocking or counting.
    Voided,
    /// Stripe wrote the invoice off. It stops blocking or counting; a late
    /// payment still reports it paid.
    Uncollectible,
}

impl CreditReloadStatus {
    /// Whether a provider report of `next` may replace this status.
    pub fn accepts(self, next: Self) -> bool {
        if self == next {
            return false;
        }
        match self {
            Self::Paid | Self::Voided => false,
            Self::Uncollectible => matches!(next, Self::Paid | Self::Voided),
            Self::Pending | Self::RequiresAction | Self::Failed => true,
        }
    }

    /// Whether Stripe may still collect this reload, so it blocks a new one
    /// and counts against the monthly limit. The Postgres adapter mirrors
    /// this predicate in SQL.
    pub fn may_collect(self, has_invoice: bool) -> bool {
        match self {
            Self::Pending | Self::RequiresAction | Self::Paid => true,
            Self::Failed => has_invoice,
            Self::Voided | Self::Uncollectible => false,
        }
    }

    /// Whether this outcome pauses automatic reloads until the payer acts.
    pub fn suspends(self) -> bool {
        matches!(
            self,
            Self::RequiresAction | Self::Failed | Self::Voided | Self::Uncollectible
        )
    }
}

/// What the payment provider reports about one of this crate's one-off
/// invoices (an overage chunk or a credit reload), whether through a webhook,
/// a collection attempt, or a reconciliation read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvoiceOutcome {
    /// Collected.
    Paid,
    /// A payment attempt was declined. The invoice stays open for the
    /// provider's own retries.
    PaymentFailed,
    /// The payment needs the customer to authenticate (3-D Secure and the
    /// like). The provider does not retry on its own; the customer completes
    /// it on `hosted_invoice_url`.
    ActionRequired {
        /// The Stripe-hosted invoice page, when the provider supplied it.
        hosted_invoice_url: Option<String>,
    },
    /// The invoice was voided: final, it never collects.
    Voided,
    /// The invoice was written off: no more automatic collection, though a
    /// late payment still reports [`Paid`](Self::Paid).
    Uncollectible,
}

impl InvoiceOutcome {
    /// The charge status this outcome moves an overage invoice to.
    pub fn charge_status(&self) -> OverageChargeStatus {
        match self {
            Self::Paid => OverageChargeStatus::Paid,
            Self::PaymentFailed => OverageChargeStatus::Failed,
            Self::ActionRequired { .. } => OverageChargeStatus::RequiresAction,
            Self::Voided => OverageChargeStatus::Voided,
            Self::Uncollectible => OverageChargeStatus::Uncollectible,
        }
    }

    /// The reload status this outcome moves a credit reload invoice to.
    pub fn reload_status(&self) -> CreditReloadStatus {
        match self {
            Self::Paid => CreditReloadStatus::Paid,
            Self::PaymentFailed => CreditReloadStatus::Failed,
            Self::ActionRequired { .. } => CreditReloadStatus::RequiresAction,
            Self::Voided => CreditReloadStatus::Voided,
            Self::Uncollectible => CreditReloadStatus::Uncollectible,
        }
    }

    /// The hosted invoice page carried by an action-required report.
    pub fn hosted_invoice_url(&self) -> Option<&str> {
        match self {
            Self::ActionRequired { hosted_invoice_url } => hosted_invoice_url.as_deref(),
            _ => None,
        }
    }
}

/// Which of this crate's one-off invoices a [`PaymentAction`] belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PaymentActionKind {
    /// An overage chunk.
    OverageCharge,
    /// An automatic credit reload.
    CreditReload,
}

/// A payment of the payer's that is waiting on them to authenticate it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PaymentAction {
    /// What the invoice is for.
    pub kind: PaymentActionKind,
    /// Amount awaiting authentication, in customer cents.
    pub amount_cents: i64,
    /// The Stripe-hosted invoice page where the payer completes it. `null`
    /// when the provider did not supply one; Stripe also emails the link.
    pub hosted_invoice_url: Option<String>,
}

/// Why a request was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum DenyReason {
    /// The plan's included AI is used up and no credits or overage remain.
    AllowanceExhausted,
    /// The free plan's monthly AI is used up. Free has no credits or overage;
    /// only an upgrade (or the next month) lifts it.
    FreeAllowanceExhausted,
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
            DenyReason::FreeAllowanceExhausted => "ai_free_allowance_exhausted",
            DenyReason::OverageLimitReached => "ai_overage_limit_reached",
            DenyReason::OveragePaymentFailed => "ai_overage_payment_failed",
        }
    }

    /// A short human-readable explanation.
    pub fn message(self) -> &'static str {
        match self {
            DenyReason::AllowanceExhausted => {
                "You've used this period's included AI. Add credits or turn on automatic reload to keep going."
            }
            DenyReason::FreeAllowanceExhausted => {
                "You've used this month's free AI. Upgrade to a paid plan to keep going."
            }
            DenyReason::OverageLimitReached => {
                "You've reached your AI spending limit for this period. Raise the limit or add credits to keep going."
            }
            DenyReason::OveragePaymentFailed => {
                "Your last automatic credit reload didn't go through. Update your payment method and re-enable automatic reload."
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

/// The payer's automatic reload settings, as shown in Billing settings.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AutoReloadSnapshot {
    /// Reload once the effective balance drops below this, in customer cents.
    pub minimum_balance_cents: i64,
    /// Reload the balance back up to this, in customer cents.
    pub target_balance_cents: i64,
    /// Most reloaded per UTC calendar month, in customer cents. `null` when
    /// there is no limit.
    pub monthly_spend_limit_cents: Option<i64>,
    /// Whether reloads are paused after a failed reload charge.
    pub suspended: bool,
    /// Whether reloads will fire: the payer opted in and reloads are not suspended.
    pub active: bool,
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
    /// Seats billed to the payer.
    pub seats: u32,
    /// Period start.
    pub period_start: DateTime<Utc>,
    /// Period end (exclusive).
    pub period_end: DateTime<Utc>,
    /// Included AI for this user's seat this period, in cents at provider cost.
    pub included_cents: i64,
    /// AI used by this user this period, in cents at provider cost.
    pub used_cents: i64,
    /// Shared payer credits already applied to this period, in customer cents.
    pub credits_consumed_cents: i64,
    /// Shared prepaid credit balance, in customer cents.
    pub credit_balance_cents: i64,
    /// Legacy API name for the automatic reload opt-in. Never authorizes direct charges.
    pub overage_enabled: bool,
    /// Per-period overage cap, in customer cents.
    pub overage_limit_cents: i64,
    /// Shared overage charged so far this period, in customer cents.
    pub overage_charged_cents: i64,
    /// Whether overage is paused after a failed charge.
    pub overage_suspended: bool,
    /// Automatic credit reload settings. `active` means the payer opted in and
    /// reloads are not suspended.
    pub auto_reload: AutoReloadSnapshot,
    /// Team-wide usage beyond per-seat allowances, at the overage markup, that
    /// is not yet covered by shared credits or charges (awaiting settlement).
    /// Customer cents.
    pub uncovered_cents: i64,
    /// Cost cents of usage this seat may still consume: its remaining allowance
    /// plus whatever shared credit and overage headroom pays for at the markup.
    /// 0 when blocked.
    pub remaining_cents: i64,
    /// Why requests are refused right now, if they are.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<DenyReason>,
    /// The newest overage or reload payment waiting on the payer to
    /// authenticate it, if any. Overage or reloads stay suspended until they
    /// do, or until they re-enable the feature with a working card.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_action: Option<PaymentAction>,
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
    /// Direct usage billing has been retired; only prepaid credits fund extra usage.
    #[error("direct usage billing is no longer available; use automatic credit reload")]
    DirectUsageBillingDisabled,
    /// Automatic reload thresholds that could never charge or exceed the
    /// offered range ([`AutoReloadThresholds::validate`]).
    #[error("invalid automatic reload settings: {0}")]
    InvalidAutoReload(&'static str),
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
