//! Prospective usage-policy activation. Stripe transport and base subscription
//! operations stay outside this use case; neither roles nor calendar anchors can
//! authorize an allowance reset.

use ai_usage::domain::financial::{FinancialError, FinancialResult};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use super::models::{BillingPeriod, Result, UsagePolicy};

#[cfg(test)]
mod test;

/// Validated provider billing identity. Domain code does not depend on a Stripe
/// SDK version, and malformed identities cannot become durable activation facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String")]
pub struct BillingIdentity(String);

impl BillingIdentity {
    /// Stable provider representation for persistence and owning-domain ports.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for BillingIdentity {
    type Error = FinancialError;

    fn try_from(value: String) -> FinancialResult<Self> {
        let Some((prefix, suffix)) = value.split_once('_') else {
            return Err(FinancialError::InvalidIdentifier);
        };
        if !matches!(prefix, "evt" | "sub" | "cus" | "si" | "price" | "prod")
            || suffix.is_empty()
            || !suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err(FinancialError::InvalidIdentifier);
        }
        Ok(Self(value))
    }
}

impl std::str::FromStr for BillingIdentity {
    type Err = FinancialError;
    fn from_str(value: &str) -> FinancialResult<Self> {
        value.to_owned().try_into()
    }
}

impl std::fmt::Display for BillingIdentity {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Immutable rollout configuration, supplied only after producer/rollout gates pass.
/// It is persisted with every observation so a restart cannot move the effective date.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageRollout {
    /// Prospective rollout instant. Never derive this from process startup time.
    pub effective_at: DateTime<Utc>,
    /// Explicit verified $40 price; not the purchasable catalog or a role mapping.
    pub price_id: BillingIdentity,
    /// Product owning that price.
    pub product_id: BillingIdentity,
}

impl UsageRollout {
    /// Reject malformed configuration before constructing the activation service.
    pub fn validate(&self) -> FinancialResult<()> {
        if !self.price_id.as_str().starts_with("price_")
            || !self.product_id.as_str().starts_with("prod_")
            || !self
                .effective_at
                .timestamp_subsec_nanos()
                .is_multiple_of(1000)
        {
            return Err(FinancialError::InvalidIdentifier);
        }
        Ok(())
    }
}

/// Why a verified Stripe period was observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeriodEvidence {
    /// Explicit rollout inventory, freshly retrieved from the provider. This
    /// capability is never inferred from an old webhook's delivery time.
    RolloutBaseline,
    /// Current subscription snapshot or ordinary update; may establish a baseline only.
    Snapshot,
    /// First paid period of a newly created subscription.
    Initial,
    /// Paid subscription-cycle invoice whose line matches this item and exact interval.
    Renewal,
}

/// Verified subscription status relevant to prospective policy activation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubscriptionActivity {
    /// Eligible to activate on a matching paid period.
    Active,
    /// May establish the rollout baseline, but never authorizes paid usage policy.
    Trialing,
    /// Canceled, paused, unpaid, unknown, or otherwise inactive.
    Inactive,
}

/// Facts about one subscription item, verified by the payment-provider adapter.
/// Discounts are deliberately absent: qualification uses the undiscounted price,
/// never the amount paid on an invoice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubscriptionPeriod {
    /// Signed event or explicit rollout-inventory identity, retained for replay/audit.
    pub event_id: BillingIdentity,
    /// Event occurrence time (or fresh inventory observation time), never the
    /// delivery time of a historical webhook.
    pub event_at: DateTime<Utc>,
    /// Durable subscription identity.
    pub subscription_id: BillingIdentity,
    /// Subscription creation time distinguishes existing from new subscribers.
    pub subscription_created_at: DateTime<Utc>,
    /// Customer identity checked against the owning domain's stored binding.
    pub customer_id: BillingIdentity,
    /// Team metadata, checked against the owning team's subscription binding.
    pub team_id: Option<macro_uuid::Uuid>,
    /// Number of seats on this item.
    pub quantity: u64,
    /// Number of items in the complete subscription (personal subscriptions need one).
    pub item_count: usize,
    /// Subscription item identity, not its position in the payload.
    pub item_id: BillingIdentity,
    /// Immutable price identity.
    pub price_id: BillingIdentity,
    /// Product owning the price.
    pub product_id: BillingIdentity,
    /// Undiscounted price in cents.
    pub unit_amount: Option<i64>,
    /// Price currency.
    pub currency: String,
    /// True only for a recurring price with interval=month, interval_count=1.
    pub monthly: bool,
    /// Trials may establish a baseline; only active paid periods can activate.
    pub activity: SubscriptionActivity,
    /// Explicit provider interval, never a calendar fallback or extrapolated anchor.
    pub period: BillingPeriod,
    /// Verified cause of this observation.
    pub evidence: PeriodEvidence,
}

/// A seat/customer binding resolved through the owning identity/subscription port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatPeriodObservation {
    /// Seat owns its allowance even after departure or rejoin.
    pub seat: MacroUserIdStr<'static>,
    /// Frozen payer, never recomputed when historical usage completes.
    pub payer: MacroUserIdStr<'static>,
    /// Verified subscription and item facts.
    pub subscription: SubscriptionPeriod,
}

/// Durable transition state for a payer/subscription/item. Seats joining an
/// already verified period share its renewal proof, but never share allowance.
/// Financial allocations
/// remain in their original periods and are never changed by these transitions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EligibilityState {
    /// End of the explicitly observed period spanning rollout for existing users.
    pub baseline_end: Option<DateTime<Utc>>,
    /// Highest accepted start, rejecting out-of-order regressions.
    pub latest_start: Option<DateTime<Utc>>,
    /// End paired with the latest start; a same-period seat join must match both.
    pub latest_end: Option<DateTime<Utc>>,
    /// First effective V1 period, immutable once selected.
    pub effective_start: Option<DateTime<Utc>>,
}

/// Activation exceptions are durable and inspectable, not guessed monthly periods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActivationException {
    /// Missing or unsupported price/product/recurrence/status facts.
    Ineligible,
    /// Event predates rollout or does not prove the supplied interval has begun.
    Delayed,
    /// Period regresses or overlaps a previously accepted period.
    Stale,
    /// Existing subscriber lacks an observed rollout baseline.
    MissingBaseline,
    /// An ordinary update cannot authorize a new-policy period.
    UnverifiedRenewal,
    /// Historical seat or payer attribution conflicts with this observation.
    AmbiguousBinding,
    /// Legacy admission/financial activity already exists in the target period.
    LegacyPeriodInUse,
}

/// Pure transition result persisted atomically with any immutable usage period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeriodDecision {
    /// Preserve legacy accounting for the current rollout period.
    Legacy,
    /// Publish exactly one new immutable usage period.
    Activate,
    /// No policy change; retain the reason for operational review.
    Exception(ActivationException),
}

impl PeriodDecision {
    /// A delayed renewal must not convert an already-open legacy period. The
    /// repository supplies this fact under the shared payer serialization lock.
    pub fn preserve_legacy(self, legacy_in_use: bool) -> Self {
        if self == Self::Activate && legacy_in_use {
            Self::Exception(ActivationException::LegacyPeriodInUse)
        } else {
            self
        }
    }

    /// Policy to publish; exceptions never authorize traffic.
    pub fn policy(&self) -> Option<UsagePolicy> {
        match self {
            Self::Legacy => Some(UsagePolicy::Legacy),
            Self::Activate => Some(UsagePolicy::PublicAllowanceV1),
            Self::Exception(_) => None,
        }
    }
}

/// Decide from immutable provider facts under the repository's seat/payer locks.
/// No current credit balance, opt-in, cap, role, or invoice total participates.
pub fn transition(
    rollout: &UsageRollout,
    facts: &SubscriptionPeriod,
    state: &mut EligibilityState,
) -> PeriodDecision {
    use ActivationException as Exception;
    let period = facts.period;
    if facts.price_id != rollout.price_id
        || facts.product_id != rollout.product_id
        || facts.unit_amount != Some(4_000)
        || facts.currency != "usd"
        || !facts.monthly
        || facts.activity == SubscriptionActivity::Inactive
        || facts.quantity == 0
        || facts.item_count == 0
        || facts.subscription_created_at > period.start
        || period.start >= period.end
        || [
            (facts.event_id.as_str(), "evt_"),
            (facts.subscription_id.as_str(), "sub_"),
            (facts.customer_id.as_str(), "cus_"),
            (facts.item_id.as_str(), "si_"),
            (rollout.price_id.as_str(), "price_"),
            (rollout.product_id.as_str(), "prod_"),
        ]
        .iter()
        .any(|(id, prefix)| !id.starts_with(prefix))
    {
        return PeriodDecision::Exception(Exception::Ineligible);
    }
    let inventory = facts.evidence == PeriodEvidence::RolloutBaseline
        && period.start <= facts.event_at
        && facts.event_at < period.end
        && facts.event_at <= rollout.effective_at;
    if (facts.event_at < rollout.effective_at && !inventory)
        || facts.event_at < period.start
        || facts.event_at >= period.end
    {
        return PeriodDecision::Exception(Exception::Delayed);
    }
    if state.latest_start.is_some_and(|start| period.start < start) {
        return PeriodDecision::Exception(Exception::Stale);
    }
    if period.start < rollout.effective_at && rollout.effective_at <= period.end {
        if state.baseline_end.is_some_and(|end| end != period.end) {
            return PeriodDecision::Exception(Exception::Stale);
        }
        state.baseline_end = Some(period.end);
        state.latest_start = Some(period.start);
        state.latest_end = Some(period.end);
        return PeriodDecision::Legacy;
    }
    if facts.activity != SubscriptionActivity::Active {
        return PeriodDecision::Exception(Exception::Ineligible);
    }
    // A new/rejoining seat can use a renewal already verified for this item.
    // This is not permission to roll the item forward on an ordinary update.
    if state.effective_start.is_some()
        && state.latest_start == Some(period.start)
        && state.latest_end == Some(period.end)
    {
        return PeriodDecision::Activate;
    }
    if facts.subscription_created_at < rollout.effective_at {
        let Some(end) = state.baseline_end else {
            return PeriodDecision::Exception(Exception::MissingBaseline);
        };
        if period.start < end {
            return PeriodDecision::Exception(Exception::Stale);
        }
        if facts.evidence != PeriodEvidence::Renewal {
            return PeriodDecision::Exception(Exception::UnverifiedRenewal);
        }
    } else if period.start < rollout.effective_at
        || !matches!(
            facts.evidence,
            PeriodEvidence::Initial | PeriodEvidence::Renewal
        )
    {
        return PeriodDecision::Exception(Exception::UnverifiedRenewal);
    }
    state.latest_start = Some(period.start);
    state.latest_end = Some(period.end);
    state.effective_start.get_or_insert(period.start);
    PeriodDecision::Activate
}

/// Owning-domain identity resolution. None means quarantine, never email inference.
pub trait PeriodBindingSource: Send + Sync + 'static {
    /// Verify customer/subscription/team identity and resolve stored $40-seat
    /// candidates. The domain transition must still verify the item's exact
    /// price/product/recurrence; these candidates alone never prove eligibility.
    fn seats(
        &self,
        payer: &MacroUserIdStr<'_>,
        observation: &SubscriptionPeriod,
    ) -> impl Future<Output = Result<Option<Vec<MacroUserIdStr<'static>>>>> + Send;
}

/// Atomic persistence of eligibility, exceptions, and immutable period publication.
pub trait PeriodRepo: Send + Sync + 'static {
    /// Apply the domain transition under seat/payer serialization. An unverified
    /// binding is retained as an exception and must not create a usage period.
    fn observe(
        &self,
        rollout: &UsageRollout,
        observation: SeatPeriodObservation,
        verified_binding: bool,
    ) -> impl Future<Output = Result<PeriodDecision>> + Send;
}

/// Renewal use case over owning-domain identity and persistence ports. It has no
/// payment gateway and therefore cannot write a Stripe price or subscription.
pub struct PeriodService<E, R> {
    bindings: E,
    repo: R,
    rollout: UsageRollout,
}

impl<E, R> PeriodService<E, R> {
    /// Construct at the composition root; invalid configuration fails startup.
    pub fn new(bindings: E, repo: R, rollout: UsageRollout) -> FinancialResult<Self> {
        rollout.validate()?;
        Ok(Self {
            bindings,
            repo,
            rollout,
        })
    }
}

impl<E: PeriodBindingSource, R: PeriodRepo> PeriodService<E, R> {
    /// Seed existing subscribers before rollout from freshly retrieved provider
    /// facts, not historical/delayed webhooks. Missing inventory at renewal remains
    /// a durable exception; it is never repaired by extrapolating an older anchor.
    pub async fn record_rollout_baseline(
        &self,
        payer: MacroUserIdStr<'static>,
        mut observation: SubscriptionPeriod,
    ) -> Result<()> {
        observation.evidence = PeriodEvidence::RolloutBaseline;
        self.sync(payer, observation).await
    }
}

impl<E: PeriodBindingSource, R: PeriodRepo> PeriodSync for PeriodService<E, R> {
    fn sync<'a>(
        &'a self,
        payer: MacroUserIdStr<'static>,
        observation: SubscriptionPeriod,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let seats = self.bindings.seats(&payer, &observation).await?;
            let verified = seats.as_ref().is_some_and(|seats| !seats.is_empty());
            let seats = seats
                .filter(|seats| !seats.is_empty())
                .unwrap_or_else(|| vec![payer.clone()]);
            for seat in seats {
                let decision = self
                    .repo
                    .observe(
                        &self.rollout,
                        SeatPeriodObservation {
                            seat,
                            payer: payer.clone(),
                            subscription: observation.clone(),
                        },
                        verified,
                    )
                    .await?;
                if let PeriodDecision::Exception(reason) = decision {
                    tracing::warn!(?reason, subscription_id = %observation.subscription_id, "usage policy activation quarantined");
                }
            }
            Ok(())
        })
    }
}

/// Inbound capability installed by the composition root only after rollout gates.
/// Implementations resolve identities before publishing verified seat observations.
pub trait PeriodSync: Send + Sync + 'static {
    /// Synchronize a verified subscription item without any base billing writes.
    fn sync<'a>(
        &'a self,
        payer: MacroUserIdStr<'static>,
        observation: SubscriptionPeriod,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;
}
