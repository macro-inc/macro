//! Prospective public-rate policy; legacy arithmetic stays in `models` and `ledger`.
//!
//! All amounts remain exact through allocation. Included usage is per seat, not pooled;
//! credits and postpaid caps are payer-wide. Repositories must serialize admission and
//! allocation with legacy settlement and credit purchases under the same payer lock.
//! Reconcile released credits with eligible pending reservations in sequence before
//! making any remainder available to new admissions; a newer hold must not steal a
//! predecessor's eligible release pool. Keep release provenance until reconciliation.
//! Allocate in admission sequence, never completion order. Unresolved evidence blocks
//! the watermark; only proved non-execution or measured usage can release a hold.
//!
//! Holds constrain admission, not final pricing. Final pricing uses only actual earlier
//! seat usage. Earlier released credits can replace provisional postpaid holds, but
//! only within the credits and total funding budget captured at admission. Later
//! purchases or opt-in changes cannot re-fund history. Unavoidable unfunded excess is
//! Macro-absorbed, not debt. This module does not activate policy or change subscriptions.

use ai_usage::AiFeature;
use ai_usage::domain::financial::{
    CentParts, CustomerMoney, FinancialError, FundingAuthorizationId, InvocationId, PublicUsage,
};
use macro_user_id::user_id::MacroUserIdStr;
use thiserror::Error;

use super::models::{
    BillingPeriod, BillingSettings, Entitlement, MIN_STRIPE_CHARGE_CENTS, NON_BILLABLE_AI_FEATURES,
    OVERAGE_CHARGE_THRESHOLD_CENTS, PlanTier, UsagePolicy,
};

#[cfg(test)]
mod test;

const ZERO_PUBLIC: PublicUsage = PublicUsage::from_units(0);
const ZERO_MONEY: CustomerMoney = CustomerMoney::from_units(0);
const PUBLIC_UNITS_PER_CENT: u64 = CustomerMoney::UNITS_PER_CENT / 100;
const EXTRA_RATE_NUMERATOR: u64 = 105;
const EXTRA_RATE_DENOMINATOR: u64 = 100;

/// Non-rolling $20 public-provider-price allowance for each activated seat and period.
pub const INCLUDED_PUBLIC_USAGE: PublicUsage =
    PublicUsage::from_units(2_000 * PUBLIC_UNITS_PER_CENT);

/// Accounting path after a trusted caller resolves the recorded policy and entitlement.
/// This is not eligibility detection: a Premium role alone must never activate V1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountingRoute {
    /// Preserve legacy arithmetic and settlement exclusively.
    Legacy,
    /// Use this module, never also legacy settlement.
    PublicAllowanceV1,
    /// Preserve the existing feature exemption, while retaining provider analytics.
    ExemptFeature,
    /// Free/enterprise behavior stays outside this policy's customer ledger.
    Unmetered,
}

/// Preserve existing exclusions without inferring policy eligibility from a plan catalog.
pub fn accounting_route(
    policy: UsagePolicy,
    feature: AiFeature,
    entitlement: &Entitlement,
) -> AccountingRoute {
    if NON_BILLABLE_AI_FEATURES.contains(&feature) {
        return AccountingRoute::ExemptFeature;
    }
    if entitlement.unlimited || entitlement.tier == PlanTier::Free {
        return AccountingRoute::Unmetered;
    }
    match policy {
        UsagePolicy::Legacy => AccountingRoute::Legacy,
        UsagePolicy::PublicAllowanceV1 => AccountingRoute::PublicAllowanceV1,
    }
}

/// Pricing is independent of which source funds the usage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PricingCategory {
    /// First $20 public usage: zero additional customer money, no markup.
    Included,
    /// Beyond $20: public usage multiplied by exactly 1.05 (not divided by 0.95).
    Extra,
}

/// Actual consumption source, never inferred just from an enabled toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FundingSource {
    /// Per-seat public-rate allowance.
    Included,
    /// Previously purchased customer money, dollar for dollar after markup.
    Prepaid,
    /// Explicitly authorized customer liability, regardless of invoice state.
    Postpaid,
    /// Unfunded in-flight excess; never collectible from the customer.
    MacroAbsorbed,
}

/// An exact money split. A source boundary can fall inside one public picodollar,
/// so public usage is retained by pricing category, not divided/rounded by source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FundingPortion {
    /// Who funded this portion.
    pub source: FundingSource,
    /// Extra-price customer money; included portions always have zero money.
    /// For Macro-absorbed portions this is a valuation, not customer liability.
    pub amount: CustomerMoney,
}

impl FundingPortion {
    /// Pricing category is not affected by postpaid opt-in or collection status.
    pub fn category(self) -> PricingCategory {
        match self.source {
            FundingSource::Included => PricingCategory::Included,
            FundingSource::Prepaid | FundingSource::Postpaid | FundingSource::MacroAbsorbed => {
                PricingCategory::Extra
            }
        }
    }
}

/// Monotonic revision of the payer's funding settings, captured at admission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorizationRevision(u64);

impl AuthorizationRevision {
    /// Rehydrate a persisted settings revision (zero may represent initial defaults).
    pub const fn from_raw(value: u64) -> Self {
        Self(value)
    }

    /// Persistence representation.
    pub const fn raw(self) -> u64 {
        self.0
    }
}

/// Opt-in state is separate from consumption and collection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostpaidAuthorization {
    /// No authorization to create postpaid liability.
    Disabled,
    /// A failed collection prevents new postpaid authorization, not prepaid usage.
    Suspended,
    /// Explicit opt-in with a shared per-period postpaid-only cap.
    Enabled {
        /// Customer-money cap; prepaid consumption does not count toward it.
        limit: CustomerMoney,
    },
}

impl PostpaidAuthorization {
    /// Capture existing enable/cap/suspension semantics without changing settings.
    pub fn from_settings(settings: &BillingSettings) -> Result<Self, PolicyError> {
        if !settings.overage_enabled {
            return Ok(Self::Disabled);
        }
        if settings.overage_suspended_at.is_some() {
            return Ok(Self::Suspended);
        }
        if settings.overage_limit_cents <= 0 {
            return Ok(Self::Disabled);
        }
        Ok(Self::Enabled {
            limit: CustomerMoney::from_cents(settings.overage_limit_cents as u64)?,
        })
    }
}

/// Immutable admission facts. Only trusted services may construct/persist these;
/// adapters must bind policy, payer and seat to the verified period before admission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationSnapshot {
    /// Stable authorization identity for journal handoff and replay.
    pub id: FundingAuthorizationId,
    /// Exactly one actual provider attempt, not a logical multi-attempt run.
    pub invocation_id: InvocationId,
    /// Account owning shared credits and postpaid cap.
    pub payer: MacroUserIdStr<'static>,
    /// Seat whose own included allowance is consumed.
    pub seat: MacroUserIdStr<'static>,
    /// Frozen verified period; do not derive from current time at finalization.
    pub period: BillingPeriod,
    /// Policy selected prospectively for this seat/period.
    pub policy: UsagePolicy,
    /// Settings version at admission, not settlement.
    pub settings_revision: AuthorizationRevision,
    /// Frozen opt-in, suspension and cap decision.
    pub postpaid: PostpaidAuthorization,
}

/// Payer-wide admission order. Persist the next sequence under the payer lock and
/// advance the allocation watermark only over allocated/proved-unexecuted attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct AllocationSequence(u64);

impl AllocationSequence {
    /// Rehydrate a persisted sequence; zero is the first admission.
    pub const fn from_raw(value: u64) -> Self {
        Self(value)
    }

    /// Persistence representation.
    pub const fn raw(self) -> u64 {
        self.0
    }

    /// Checked successor for admission and allocation watermarks.
    pub fn next(self) -> Result<Self, PolicyError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(PolicyError::SequenceOverflow)
    }
}

/// Exact capacity observed under the payer lock before creating another reservation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FundingAvailability {
    /// Actual allocated public usage for this seat/period, never other seats' usage.
    pub seat_public_used: PublicUsage,
    /// Outstanding included holds for this seat/period only.
    pub seat_public_held: PublicUsage,
    /// Shared credits net of exact consumption, all outstanding holds and release
    /// pools still owed to earlier pending reservations. Do not restore fractional
    /// spent money from a rounded whole-cent ledger balance.
    pub prepaid_available: CustomerMoney,
    /// Prepaid held by earlier admissions. If released, these already-purchased
    /// credits can replace this attempt's provisional postpaid funding at allocation.
    pub prepaid_held: CustomerMoney,
    /// All incurred postpaid in this payer/period, including uncollected and paid.
    pub postpaid_incurred: CustomerMoney,
    /// All outstanding postpaid holds sharing this payer/period cap.
    pub postpaid_held: CustomerMoney,
}

/// Provisional budgets, not pricing or final funding classifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FundingHolds {
    /// Public allowance provisionally held for this attempt.
    pub included_public: PublicUsage,
    /// Exact prepaid money held exclusively for this attempt.
    pub prepaid: CustomerMoney,
    /// Exact, explicitly authorized postpaid budget held against the cap.
    pub postpaid: CustomerMoney,
}

/// Reservation lifecycle, separate from usage pricing and collection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReservationState {
    /// Awaiting reliable evidence and its deterministic allocation turn.
    Held,
    /// Actual usage consumed the needed funds; unused holds were released.
    Consumed,
    /// Proved not executed; entire hold released without inventing provider evidence.
    Released,
}

/// Allocation lifecycle. Evidence state remains owned by the invocation journal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AllocationState {
    /// Evidence is pending/unresolved or a preceding admission still blocks allocation.
    Unallocated,
    /// Immutable pricing and funding facts, independent of current billing settings.
    Allocated(UsageAllocation),
    /// Proved non-execution, distinct from measured zero provider usage.
    NotExecuted,
}

/// Bounded admission for one provider attempt. Persist before acknowledging execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reservation {
    authorization: AuthorizationSnapshot,
    sequence: AllocationSequence,
    maximum_public_usage: PublicUsage,
    holds: FundingHolds,
    prepaid_reclaim_limit: CustomerMoney,
    allocation: AllocationState,
}

/// Actual prior usage read at the allocation watermark, not admission's projected usage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocationPosition {
    /// Next unresolved sequence for this payer. Later completions must wait.
    pub next_sequence: AllocationSequence,
    /// Actual prior allocated usage for this reservation's frozen seat and period.
    pub seat_public_used: PublicUsage,
    /// Still-unspent credits released by earlier admissions that held them when this
    /// attempt was admitted. Exclude later purchases and releases from later attempts.
    /// The repository must retain release provenance and debit this pool atomically;
    /// neither the current cent balance nor the current toggle proves eligibility.
    pub prepaid_released_before: CustomerMoney,
}

/// Final exact split for one invocation. Preserve these facts through credit purchases,
/// toggle changes and collection retries; never rerun funding against today's balances.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageAllocation {
    /// Public usage classified as included, without markup or liability.
    pub included_public: PublicUsage,
    /// Public usage classified as extra (including unavoidable unfunded excess).
    pub extra_public: PublicUsage,
    /// Previously paid credit consumed; not a new invoice or liability.
    pub prepaid: CustomerMoney,
    /// Subset of `prepaid` drawn from eligible earlier releases instead of this
    /// attempt's original hold. Debit that release pool once, not the original hold.
    pub reclaimed_prepaid: CustomerMoney,
    /// Authorized incurred liability, irrespective of whether it has been collected.
    pub postpaid: CustomerMoney,
    /// Extra-price valuation of unfunded overshoot, not provider expense or customer debt.
    pub macro_absorbed: CustomerMoney,
}

impl UsageAllocation {
    /// Exact extra valuation, including Macro-absorbed usage.
    pub fn extra_money(&self) -> Result<CustomerMoney, PolicyError> {
        Ok(self
            .prepaid
            .checked_add(self.postpaid)?
            .checked_add(self.macro_absorbed)?)
    }

    /// Only postpaid creates new customer liability; credit purchases were paid separately.
    pub fn customer_liability(&self) -> CustomerMoney {
        self.postpaid
    }

    /// Stable funding-source order; zero portions may be omitted by presentation adapters.
    pub fn funding_portions(&self) -> [FundingPortion; 4] {
        [
            FundingPortion {
                source: FundingSource::Included,
                amount: ZERO_MONEY,
            },
            FundingPortion {
                source: FundingSource::Prepaid,
                amount: self.prepaid,
            },
            FundingPortion {
                source: FundingSource::Postpaid,
                amount: self.postpaid,
            },
            FundingPortion {
                source: FundingSource::MacroAbsorbed,
                amount: self.macro_absorbed,
            },
        ]
    }
}

fn remaining_included(used: PublicUsage) -> PublicUsage {
    PublicUsage::from_units(INCLUDED_PUBLIC_USAGE.units().saturating_sub(used.units()))
}

fn extra_price(usage: PublicUsage) -> Result<CustomerMoney, PolicyError> {
    Ok(CustomerMoney::from_public_ratio(
        usage,
        EXTRA_RATE_NUMERATOR,
        EXTRA_RATE_DENOMINATOR,
    )?)
}

fn available_holds(
    authorization: &AuthorizationSnapshot,
    available: FundingAvailability,
) -> Result<FundingHolds, PolicyError> {
    if authorization.policy != UsagePolicy::PublicAllowanceV1 {
        return Err(PolicyError::WrongPolicy);
    }
    let postpaid = match authorization.postpaid {
        PostpaidAuthorization::Disabled | PostpaidAuthorization::Suspended => ZERO_MONEY,
        PostpaidAuthorization::Enabled { limit } => {
            let committed = available
                .postpaid_incurred
                .checked_add(available.postpaid_held)?;
            CustomerMoney::from_units(limit.units().saturating_sub(committed.units()))
        }
    };
    Ok(FundingHolds {
        included_public: remaining_included(
            available
                .seat_public_used
                .checked_add(available.seat_public_held)?,
        ),
        prepaid: available.prepaid_available,
        postpaid,
    })
}

/// Maximum fully funded public usage up to a trusted execution ceiling. Floor only this
/// admission bound, never actual usage/money. Hosts must lower their execution ceiling
/// before retrying a rejected admission; an oversized token budget is not authorized.
pub fn funded_capacity(
    authorization: &AuthorizationSnapshot,
    maximum_public_usage: PublicUsage,
    available: FundingAvailability,
) -> Result<PublicUsage, PolicyError> {
    let holds = available_holds(authorization, available)?;
    let money = u128::from(holds.prepaid.units()) + u128::from(holds.postpaid.units());
    let money_per_public_unit = extra_price(PublicUsage::from_units(1))?.units();
    let public =
        u128::from(holds.included_public.units()) + money / u128::from(money_per_public_unit);
    Ok(PublicUsage::from_units(
        public.min(u128::from(maximum_public_usage.units())) as u64,
    ))
}

/// Reserve the complete trusted per-attempt ceiling, credit-first. No partially funded
/// execution is admitted. A rejection carries the maximum affordable smaller ceiling.
pub fn reserve(
    authorization: AuthorizationSnapshot,
    sequence: AllocationSequence,
    maximum_public_usage: PublicUsage,
    available: FundingAvailability,
) -> Result<Reservation, PolicyError> {
    if maximum_public_usage == ZERO_PUBLIC {
        return Err(PolicyError::EmptyBudget);
    }
    let capacity = funded_capacity(&authorization, maximum_public_usage, available)?;
    if maximum_public_usage > capacity {
        return Err(PolicyError::InsufficientFunding {
            maximum_public_usage: capacity,
        });
    }
    let prior_prepaid_held = available.prepaid_held;
    let available = available_holds(&authorization, available)?;
    let included_public = maximum_public_usage.min(available.included_public);
    let extra = extra_price(maximum_public_usage.checked_sub(included_public)?)?;
    let prepaid = extra.min(available.prepaid);
    let postpaid = extra.checked_sub(prepaid)?;
    Ok(Reservation {
        authorization,
        sequence,
        maximum_public_usage,
        holds: FundingHolds {
            included_public,
            prepaid,
            postpaid,
        },
        prepaid_reclaim_limit: prior_prepaid_held.min(postpaid),
        allocation: AllocationState::Unallocated,
    })
}

impl Reservation {
    /// Captured facts, never a live settings lookup.
    pub fn authorization(&self) -> &AuthorizationSnapshot {
        &self.authorization
    }

    /// Payer-wide deterministic allocation order.
    pub fn sequence(&self) -> AllocationSequence {
        self.sequence
    }

    /// Public-price execution ceiling acknowledged to the producer.
    pub fn maximum_public_usage(&self) -> PublicUsage {
        self.maximum_public_usage
    }

    /// Original exact holds; release unused amounts only when resolved.
    pub fn holds(&self) -> FundingHolds {
        self.holds
    }

    /// Captured ceiling on earlier held credits that may replace provisional postpaid.
    pub fn prepaid_reclaim_limit(&self) -> CustomerMoney {
        self.prepaid_reclaim_limit
    }

    /// Reservation lifecycle derived from allocation, avoiding inconsistent flags.
    pub fn state(&self) -> ReservationState {
        match self.allocation {
            AllocationState::Unallocated => ReservationState::Held,
            AllocationState::Allocated(_) => ReservationState::Consumed,
            AllocationState::NotExecuted => ReservationState::Released,
        }
    }

    /// Immutable source allocation when resolved, never an invoice status.
    pub fn allocation_state(&self) -> &AllocationState {
        &self.allocation
    }

    fn require_held(&self) -> Result<(), PolicyError> {
        if self.state() != ReservationState::Held {
            return Err(PolicyError::ReservationResolved);
        }
        Ok(())
    }

    /// Reconcile complete evidence at the payer's allocation watermark. Only actual
    /// earlier usage consumes allowance. No current toggle/credit input is accepted.
    /// Persist this transition, source debits, releases and watermark atomically;
    /// repositories handle identical replay by returning the already persisted result.
    pub fn allocate(
        &mut self,
        position: AllocationPosition,
        actual: PublicUsage,
    ) -> Result<UsageAllocation, PolicyError> {
        self.require_held()?;
        if position.next_sequence != self.sequence {
            return Err(PolicyError::OutOfOrder);
        }
        // Check the total the repository will persist before changing any state.
        position.seat_public_used.checked_add(actual)?;
        let included_public = actual.min(remaining_included(position.seat_public_used));
        let extra_public = actual.checked_sub(included_public)?;
        let extra = extra_price(extra_public)?;
        let prepaid = extra.min(self.holds.prepaid);
        let remainder = extra.checked_sub(prepaid)?;
        let postpaid_budget = remainder.min(self.holds.postpaid);
        let reclaimed_prepaid = postpaid_budget
            .min(self.prepaid_reclaim_limit)
            .min(position.prepaid_released_before);
        let allocation = UsageAllocation {
            included_public,
            extra_public,
            prepaid: prepaid.checked_add(reclaimed_prepaid)?,
            reclaimed_prepaid,
            postpaid: postpaid_budget.checked_sub(reclaimed_prepaid)?,
            macro_absorbed: remainder.checked_sub(postpaid_budget)?,
        };
        self.allocation = AllocationState::Allocated(allocation.clone());
        Ok(allocation)
    }

    /// Only call with proof the provider did not execute. Timeouts/cancellation or
    /// absent counters are not proof; retain those holds for evidence reconciliation.
    pub fn release_without_execution(&mut self) -> Result<FundingHolds, PolicyError> {
        self.require_held()?;
        self.allocation = AllocationState::NotExecuted;
        Ok(self.holds)
    }

    /// Unused original budgets after final allocation or proved non-execution.
    pub fn released_holds(&self) -> Result<FundingHolds, PolicyError> {
        match &self.allocation {
            AllocationState::Unallocated => Err(PolicyError::UnresolvedReservation),
            AllocationState::NotExecuted => Ok(self.holds),
            AllocationState::Allocated(allocation) => Ok(FundingHolds {
                included_public: self
                    .holds
                    .included_public
                    .checked_sub(allocation.included_public.min(self.holds.included_public))?,
                prepaid: self.holds.prepaid.checked_sub(
                    allocation
                        .prepaid
                        .checked_sub(allocation.reclaimed_prepaid)?,
                )?,
                postpaid: self.holds.postpaid.checked_sub(allocation.postpaid)?,
            }),
        }
    }
}

/// Collection state is orthogonal to authorization and immutable source allocation.
/// Failed collection never releases prepaid or authorizes repricing/reclassification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CollectionState {
    /// Incurred liability below the existing collection threshold.
    Accruing,
    /// Reserved for an idempotent collection attempt, including an existing invoice.
    Pending,
    /// Collected; terminal even if a delayed failure notification arrives.
    Paid,
    /// Retry the same collectible charge, not a new funding allocation.
    Failed,
    /// Period-end amount below the payment minimum, explicitly forgiven.
    Forgiven,
}

/// Retain exact cumulative postpaid liability per payer/period and a whole-cent
/// booking watermark. Rounding deltas per request or settlement would overcharge.
/// The exact total is never replaced by a rounded value; after rounding up the next
/// accrual must first cover that advance before another cent can be booked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CumulativeCollection {
    exact_total: CustomerMoney,
    booked_cents: u64,
}

impl Default for CumulativeCollection {
    fn default() -> Self {
        Self::new()
    }
}

impl CumulativeCollection {
    /// Empty collection accumulator for a new payer/period (not each settlement).
    pub const fn new() -> Self {
        Self {
            exact_total: ZERO_MONEY,
            booked_cents: 0,
        }
    }

    /// Restore durable progress without permitting bookings above rounded liability.
    pub fn restore(exact_total: CustomerMoney, booked_cents: u64) -> Result<Self, PolicyError> {
        if booked_cents > round_half_up(exact_total) {
            return Err(PolicyError::InvalidCollection);
        }
        Ok(Self {
            exact_total,
            booked_cents,
        })
    }

    /// Add only newly allocated postpaid money, once per durable allocation identity.
    pub fn accrue(&mut self, amount: CustomerMoney) -> Result<(), PolicyError> {
        self.exact_total = self.exact_total.checked_add(amount)?;
        Ok(())
    }

    /// Exact total including any subcent remainder and already booked liability.
    pub fn exact_total(self) -> CustomerMoney {
        self.exact_total
    }

    /// Pending, paid, failed-but-collectible and explicitly forgiven cents, counted once.
    pub fn booked_cents(self) -> u64 {
        self.booked_cents
    }

    /// Lossless unrounded cents/remainder. Persist the total and booking watermark
    /// together; persisting only a positive remainder loses a prior rounding advance.
    pub fn remainder(self) -> CentParts {
        self.exact_total.split_cents()
    }

    /// Difference of rounded cumulative totals, never a rounded incremental amount.
    pub fn unbooked_cents(self) -> Result<u64, PolicyError> {
        round_half_up(self.exact_total)
            .checked_sub(self.booked_cents)
            .ok_or(PolicyError::InvalidCollection)
    }

    /// Advance exactly once when reserving collection or explicitly forgiving money.
    /// Retrying/finishing a reserved charge must not advance this watermark again.
    pub fn book(&mut self, cents: u64) -> Result<(), PolicyError> {
        if cents > self.unbooked_cents()? {
            return Err(PolicyError::InvalidCollection);
        }
        self.booked_cents += cents;
        Ok(())
    }

    /// Preserve existing $10 collection cadence and $0.50 period-end payment minimum.
    /// Flush/forgive only after the period has ended AND all its evidence is allocated.
    pub fn plan(self, period_closed_and_allocated: bool) -> Result<CollectionPlan, PolicyError> {
        let cents = self.unbooked_cents()?;
        if cents >= OVERAGE_CHARGE_THRESHOLD_CENTS as u64
            || (period_closed_and_allocated && cents >= MIN_STRIPE_CHARGE_CENTS as u64)
        {
            return Ok(CollectionPlan::Collect { cents });
        }
        if period_closed_and_allocated && cents > 0 {
            return Ok(CollectionPlan::Forgive { cents });
        }
        Ok(CollectionPlan::Wait)
    }
}

/// Collection action; funding has already been decided and must not be rerun.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CollectionPlan {
    /// No collectible chunk yet.
    Wait,
    /// Reserve these newly collectible cents using a stable charge identity.
    Collect {
        /// Whole-cent difference from the cumulative booking watermark.
        cents: u64,
    },
    /// Book the below-minimum period-end remainder without a payment attempt.
    Forgive {
        /// Rounded cents to forgive exactly once.
        cents: u64,
    },
}

/// Round a nonnegative cumulative customer-money total to cents: exact half cents
/// round up. Use differences of these cumulative values, never sum rounded chunks.
pub fn round_half_up(total: CustomerMoney) -> u64 {
    let parts = total.split_cents();
    parts.whole_cents + u64::from(parts.subcent_units >= CustomerMoney::UNITS_PER_CENT / 2)
}

/// Pure-policy errors; no error permits provider execution or creates customer debt.
#[derive(Debug, Error)]
pub enum PolicyError {
    /// The recorded policy belongs on another accounting path.
    #[error("public allowance allocation requires the recorded V1 policy")]
    WrongPolicy,
    /// Require a meaningful bounded provider attempt at admission.
    #[error("attempt budget must be positive")]
    EmptyBudget,
    /// Caller must constrain execution and request fresh authorization, not execute partially funded.
    #[error("attempt exceeds funded capacity")]
    InsufficientFunding {
        /// Maximum affordable public usage within the requested ceiling.
        maximum_public_usage: PublicUsage,
    },
    /// A preceding admission still requires reconciliation.
    #[error("allocation must follow payer admission order")]
    OutOfOrder,
    /// No second allocation or release of a terminal reservation.
    #[error("reservation already resolved")]
    ReservationResolved,
    /// Pending/unresolved evidence is not zero usage.
    #[error("reservation still awaits evidence or allocation")]
    UnresolvedReservation,
    /// Whole-cent progress cannot exceed rounded cumulative liability.
    #[error("invalid cumulative collection progress")]
    InvalidCollection,
    /// Allocation order never wraps.
    #[error("allocation sequence overflow")]
    SequenceOverflow,
    /// Reuse the financial domain's checked fixed-point arithmetic errors.
    #[error(transparent)]
    Arithmetic(#[from] FinancialError),
}
