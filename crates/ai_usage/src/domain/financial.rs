//! Financial invocation contracts, independent of mutable analytics pricing.
//!
//! One invocation is one actual provider attempt. Transport/delivery retries reuse
//! its ID; another provider execution (including a fallback) requires a new ID.
//! Only authenticated server-side adapters may construct trusted usage or select
//! a nonfinancial mode. No prompt, output, credential, or raw token text belongs here.

use std::num::NonZeroU16;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use thiserror::Error;

use super::ports::{AiFeature, FinancialUsage};

#[cfg(test)]
mod test;

macro_rules! financial_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(Uuid);

        impl $name {
            /// Allocate a UUIDv7 once, before the first delivery attempt.
            pub fn new() -> Self {
                Self(generate_uuid_v7())
            }

            /// The durable identifier, for persistence and transport adapters.
            pub fn as_uuid(self) -> Uuid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl TryFrom<Uuid> for $name {
            type Error = FinancialError;

            fn try_from(value: Uuid) -> FinancialResult<Self> {
                if value.is_nil() {
                    return Err(FinancialError::InvalidIdentifier);
                }
                Ok(Self(value))
            }
        }
    };
}

financial_id!(
    RunId,
    "Stable identity of a logical run across provider attempts."
);
financial_id!(
    InvocationId,
    "Stable identity of exactly one provider execution."
);
financial_id!(
    RateVersion,
    "Identity of an immutable provider-qualified rate snapshot."
);
financial_id!(
    FundingAuthorizationId,
    "Opaque reference to authorization facts owned by the funding domain."
);

/// Provider and exact API model identity. Never use analytics' bare-model normalization.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ProviderModel {
    provider: String,
    model: String,
}

impl ProviderModel {
    /// Provider keys are canonical lowercase ASCII identifiers. Model names retain
    /// their exact spelling, including slashes; whitespace/control characters are rejected.
    pub fn new(provider: impl Into<String>, model: impl Into<String>) -> FinancialResult<Self> {
        let provider = provider.into();
        let model = model.into();
        if !valid_identifier(&provider)
            || !provider
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
            || !valid_identifier(&model)
        {
            return Err(FinancialError::InvalidIdentifier);
        }
        Ok(Self { provider, model })
    }

    /// Canonical provider identity (including distinct compatible API providers).
    pub fn provider(&self) -> &str {
        &self.provider
    }

    /// Exact provider API model identifier, not a routing alias.
    pub fn model(&self) -> &str {
        &self.model
    }
}

/// Provider request identity used to reconcile evidence, not as the invocation's idempotency key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderRequestId(String);

impl ProviderRequestId {
    /// Validate an opaque request identifier without normalizing it.
    pub fn new(value: impl Into<String>) -> FinancialResult<Self> {
        let value = value.into();
        if !valid_identifier(&value) {
            return Err(FinancialError::InvalidIdentifier);
        }
        Ok(Self(value))
    }

    /// Original provider request identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Public-provider-price usage, in picodollars (10^-12 USD), not customer money.
/// $1 per million tokens is 1,000,000 units per token. No floating point or rounding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PublicUsage(u64);

impl PublicUsage {
    /// Construct an exact nonnegative public usage quantity.
    pub const fn from_units(units: u64) -> Self {
        Self(units)
    }

    /// Exact picodollar quantity.
    pub const fn units(self) -> u64 {
        self.0
    }

    /// Add without wrapping or saturating.
    pub fn checked_add(self, other: Self) -> FinancialResult<Self> {
        self.0
            .checked_add(other.0)
            .map(Self)
            .ok_or(FinancialError::ArithmeticOverflow)
    }

    /// Subtract without permitting negative usage.
    pub fn checked_sub(self, other: Self) -> FinancialResult<Self> {
        self.0
            .checked_sub(other.0)
            .map(Self)
            .ok_or(FinancialError::ArithmeticOverflow)
    }
}

/// Customer USD in hundredths of a picodollar (10^-14 USD). The extra two decimal
/// places preserve percentage pricing, including 1.05, exactly for every public unit.
/// This is distinct from public usage and from the whole-cent payment ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CustomerMoney(u64);

impl CustomerMoney {
    /// Customer-money units in one cent.
    pub const UNITS_PER_CENT: u64 = 1_000_000_000_000;

    /// Construct an exact nonnegative customer-money amount.
    pub const fn from_units(units: u64) -> Self {
        Self(units)
    }

    /// Exact hundredth-picodollar quantity.
    pub const fn units(self) -> u64 {
        self.0
    }

    /// Convert whole-cent ledger money without overflow.
    pub fn from_cents(cents: u64) -> FinancialResult<Self> {
        narrow(u128::from(cents) * u128::from(Self::UNITS_PER_CENT)).map(Self)
    }

    /// Convert public usage at an explicit rational price multiplier. Policy chooses
    /// the ratio; this conversion never decides whether usage is included or extra.
    /// Reject unrepresentable fractions rather than silently losing a remainder.
    pub fn from_public_ratio(
        usage: PublicUsage,
        numerator: u64,
        denominator: u64,
    ) -> FinancialResult<Self> {
        if denominator == 0 {
            return Err(FinancialError::ZeroDenominator);
        }
        let scaled = u128::from(usage.units())
            .checked_mul(100)
            .and_then(|value| value.checked_mul(u128::from(numerator)))
            .ok_or(FinancialError::ArithmeticOverflow)?;
        let denominator = u128::from(denominator);
        if scaled % denominator != 0 {
            return Err(FinancialError::InsufficientPrecision);
        }
        narrow(scaled / denominator).map(Self)
    }

    /// Add without wrapping or saturating.
    pub fn checked_add(self, other: Self) -> FinancialResult<Self> {
        self.0
            .checked_add(other.0)
            .map(Self)
            .ok_or(FinancialError::ArithmeticOverflow)
    }

    /// Subtract without permitting negative customer money.
    pub fn checked_sub(self, other: Self) -> FinancialResult<Self> {
        self.0
            .checked_sub(other.0)
            .map(Self)
            .ok_or(FinancialError::ArithmeticOverflow)
    }

    /// Separate cents from the exact subcent remainder. This does not round;
    /// settlement must retain the remainder and round only cumulative liability.
    pub const fn split_cents(self) -> CentParts {
        CentParts {
            whole_cents: self.0 / Self::UNITS_PER_CENT,
            subcent_units: self.0 % Self::UNITS_PER_CENT,
        }
    }
}

fn narrow(value: u128) -> FinancialResult<u64> {
    u64::try_from(value).map_err(|_| FinancialError::ArithmeticOverflow)
}

/// Lossless decomposition of customer money for the whole-cent payment boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CentParts {
    /// Whole USD cents, without rounding.
    pub whole_cents: u64,
    /// Remaining [`CustomerMoney`] units, strictly less than one cent.
    pub subcent_units: u64,
}

/// Complete, trusted provider counters normalized into mutually exclusive buckets.
/// Adapters must verify provider semantics: inclusive cache/reasoning counters are
/// not additional tokens. Missing/estimated counters must not be filled with zero.
/// Zero is allowed only when reported or known to be inapplicable to this model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedTokenUsage {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    reasoning: u64,
}

impl TrustedTokenUsage {
    /// Construct verified, non-overlapping counters. Input excludes cache reads and
    /// writes; output excludes reasoning. Do not pass unverified client counters.
    pub const fn from_disjoint(
        input: u64,
        output: u64,
        cache_read: u64,
        cache_write: u64,
        reasoning: u64,
    ) -> Self {
        Self {
            input,
            output,
            cache_read,
            cache_write,
            reasoning,
        }
    }

    /// Normalize providers whose input includes both cache buckets and whose output
    /// includes reasoning. Other provider semantics must use `from_disjoint` instead.
    pub fn from_inclusive_totals(
        input: u64,
        output: u64,
        cache_read: u64,
        cache_write: u64,
        reasoning: u64,
    ) -> FinancialResult<Self> {
        let input = input
            .checked_sub(cache_read)
            .and_then(|value| value.checked_sub(cache_write))
            .ok_or(FinancialError::InvalidTokenUsage)?;
        let output = output
            .checked_sub(reasoning)
            .ok_or(FinancialError::InvalidTokenUsage)?;
        Ok(Self::from_disjoint(
            input,
            output,
            cache_read,
            cache_write,
            reasoning,
        ))
    }

    /// Input excluding cache reads and writes.
    pub const fn input(self) -> u64 {
        self.input
    }
    /// Output excluding reasoning.
    pub const fn output(self) -> u64 {
        self.output
    }
    /// Cache-read tokens, not included in `input`.
    pub const fn cache_read(self) -> u64 {
        self.cache_read
    }
    /// Cache-write tokens, not included in `input`.
    pub const fn cache_write(self) -> u64 {
        self.cache_write
    }
    /// Reasoning tokens, not included in `output`.
    pub const fn reasoning(self) -> u64 {
        self.reasoning
    }
}

/// Public picodollars per token, for each disjoint dimension. Different cache TTLs
/// or pricing regimes require distinct immutable versions; never blend unknown rates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenRates {
    /// Non-cache input rate.
    pub input: u64,
    /// Non-reasoning output rate.
    pub output: u64,
    /// Cache-read rate.
    pub cache_read: u64,
    /// Cache-write rate.
    pub cache_write: u64,
    /// Reasoning rate (often the output rate, but explicitly captured).
    pub reasoning: u64,
}

impl TokenRates {
    /// Price complete evidence exactly, using checked wider intermediates for products and sums.
    pub fn price(self, usage: TrustedTokenUsage) -> FinancialResult<PublicUsage> {
        let dimensions = [
            (self.input, usage.input),
            (self.output, usage.output),
            (self.cache_read, usage.cache_read),
            (self.cache_write, usage.cache_write),
            (self.reasoning, usage.reasoning),
        ];
        let total = dimensions
            .into_iter()
            .try_fold(0_u128, |total, (rate, tokens)| {
                total
                    .checked_add(u128::from(rate) * u128::from(tokens))
                    .ok_or(FinancialError::ArithmeticOverflow)
            })?;
        narrow(total).map(PublicUsage)
    }
}

/// Immutable financial price facts. Repositories must enforce that a version is
/// bound permanently to these fields; analytics repricing cannot mutate them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RateSnapshot {
    /// Immutable rate identity, resolved before funding authorization.
    pub version: RateVersion,
    /// Actual provider and model to which the rates apply.
    pub model: ProviderModel,
    /// Inclusive start of this version's applicability.
    pub effective_at: DateTime<Utc>,
    /// Explicit rates for every normalized token dimension.
    pub tokens: TokenRates,
}

impl RateSnapshot {
    /// Reject another provider/model's rates even when the bare model names match.
    pub fn require_model(&self, model: &ProviderModel) -> FinancialResult<()> {
        if &self.model != model {
            return Err(FinancialError::RateModelMismatch);
        }
        Ok(())
    }
}

/// Trusted request to admit exactly one bounded provider attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeginInvocation {
    /// Logical run identity, retained across rounds and fallbacks.
    pub run_id: RunId,
    /// Provider attempt identity, retained only across delivery retries.
    pub invocation_id: InvocationId,
    /// Authenticated originating user; funding resolves payer/seat attribution.
    pub user: MacroUserIdStr<'static>,
    /// Calling feature, verified by the host.
    pub feature: AiFeature,
    /// Related entity, if any.
    pub entity: Option<Uuid>,
    /// Actual provider/model, not a router alias.
    pub model: ProviderModel,
    /// Occurrence time, retained on replay rather than replaced by ingestion time.
    pub occurred_at: DateTime<Utc>,
    /// Verified per-dimension execution ceiling, not a measurement of actual usage.
    /// Unsupported/unbounded execution must not enter activated billable traffic.
    pub token_budget: TrustedTokenUsage,
}

impl BeginInvocation {
    /// All admission facts must match on delivery replay, not just the invocation ID.
    pub fn check_replay(&self, replay: &Self) -> FinancialResult<()> {
        if self != replay {
            return Err(FinancialError::ReplayConflict {
                invocation_id: self.invocation_id,
                phase: ReplayPhase::Begin,
            });
        }
        Ok(())
    }
}

/// Funding facts are durably captured by the injected owning domain before success.
/// The reference freezes payer, policy, period, settings revision and reserved sources
/// there; callers must never reconstruct authorization from today's billing settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FundingAuthorization {
    /// Owning-domain authorization identity.
    pub id: FundingAuthorizationId,
    /// Invocation to which authorization is exclusively bound.
    pub invocation_id: InvocationId,
    /// Public-price budget admitted for this attempt, not customer liability.
    pub maximum_public_usage: PublicUsage,
}

/// Admission facts acknowledged before contacting the provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedInvocation {
    /// Immutable invocation context and execution bound.
    pub request: BeginInvocation,
    /// Immutable rates resolved before asking for funding.
    pub rate: RateSnapshot,
    /// Durable authorization from the funding domain.
    pub funding: FundingAuthorization,
}

/// Provider outcome is independent of whether billable usage was incurred.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderOutcome {
    /// Provider execution completed successfully.
    Succeeded,
    /// Provider execution failed, possibly after incurring usage.
    Failed,
    /// Caller or provider cancelled execution, possibly after incurring usage.
    Cancelled,
    /// Execution outcome is unknown after loss of contact or process interruption.
    Unknown,
}

/// Why usage cannot yet be trusted. None of these implies zero cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnresolvedReason {
    /// Provider omitted reliable usage counters.
    UsageNotReported,
    /// Execution or stream was interrupted before complete evidence arrived.
    Interrupted,
    /// Provider counters could not be normalized without guessing.
    UnsupportedDimensions,
}

/// Explicit distinction between a measured zero and missing provider evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageEvidence {
    /// Complete server-verified provider usage, including legitimate zero usage.
    Reported(TrustedTokenUsage),
    /// No complete trusted counters; never synthesize zeros or estimate customer debt.
    Missing(UnresolvedReason),
}

/// Final provider facts submitted by a trusted adapter, not a caller-supplied charge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinalizeInvocation {
    /// Identity of the previously admitted attempt.
    pub invocation_id: InvocationId,
    /// Provider occurrence time, not the delivery retry time.
    pub occurred_at: DateTime<Utc>,
    /// Provider correlation identity when supplied.
    pub provider_request_id: Option<ProviderRequestId>,
    /// Success, failure and cancellation can all carry usage.
    pub outcome: ProviderOutcome,
    /// Complete counters or an explicit unresolved reason.
    pub usage: UsageEvidence,
}

impl FinalizeInvocation {
    /// Duplicate evidence is a no-op; changed evidence requires explicit reconciliation,
    /// never a last-write-wins overwrite or a second charge.
    pub fn check_replay(&self, replay: &Self) -> FinancialResult<()> {
        if self != replay {
            return Err(FinancialError::ReplayConflict {
                invocation_id: self.invocation_id,
                phase: ReplayPhase::Finalize,
            });
        }
        Ok(())
    }
}

/// Explicit, policy-selected reasons for no new-policy financial charge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExclusionReason {
    /// Historical/current legacy policy remains on its original accounting path.
    LegacyPolicy,
    /// Feature exemption resolved by the owning policy, not inferred from missing plumbing.
    ExemptFeature,
    /// Verified internal work has no customer liability.
    InternalWork,
}

/// Why complete evidence cannot be priced. Preserve it; do not substitute zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnpricedReason {
    /// No immutable rate matches the actual provider/model/dimensions.
    MissingRate,
    /// Evidence cannot be represented within checked financial arithmetic.
    ArithmeticOverflow,
}

/// Durable financial evidence state. Priced/unpriced require reported usage;
/// unresolved requires missing usage. The journal service validates those invariants
/// and the evidence's invocation ID before persisting a transition from pending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvocationState {
    /// Begin persisted; no final evidence acknowledged. This is not zero usage.
    Pending,
    /// Complete evidence valued at the pinned public rate, not yet a customer charge.
    Priced {
        /// Immutable provider facts.
        evidence: FinalizeInvocation,
        /// Exact public-price usage.
        public_usage: PublicUsage,
    },
    /// Evidence retained but explicitly excluded by the captured policy.
    Excluded {
        /// Immutable provider facts, possibly missing usage.
        evidence: FinalizeInvocation,
        /// Explicit exclusion decision.
        reason: ExclusionReason,
    },
    /// Complete counters exist but cannot safely be valued.
    Unpriced {
        /// Immutable provider facts.
        evidence: FinalizeInvocation,
        /// Why pricing is unavailable.
        reason: UnpricedReason,
    },
    /// Incomplete/untrusted evidence requires reconciliation, not invented debt.
    Unresolved {
        /// Immutable facts including the missing-usage reason.
        evidence: FinalizeInvocation,
    },
}

/// Queryable invocation journal entry. Funding allocation is owned by the injected
/// funding domain, not inferred from this public-price record or current opt-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvocationRecord {
    /// Acknowledged admission facts.
    pub admission: AuthorizedInvocation,
    /// Pending or finalized evidence and valuation.
    pub state: InvocationState,
}

/// Outcome of an idempotent journal write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteDisposition {
    /// This delivery durably inserted the facts for the first time.
    Inserted,
    /// Identical facts already existed. A begin replay must NOT execute the provider
    /// again: execution may already have happened despite a lost acknowledgement.
    Replayed,
}

/// Acknowledged journal value and replay disposition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recorded<T> {
    /// Durable value, identical on successful replay.
    pub value: T,
    /// Whether this was a new write or an identical replay.
    pub disposition: WriteDisposition,
}

/// Bounded, stable-ID scan for pending/unpriced/unresolved recovery work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingInvocations {
    /// Exclusive cursor in ascending invocation-ID order.
    pub after: Option<InvocationId>,
    /// Include admissions strictly older than this cutoff.
    pub before: DateTime<Utc>,
    /// Maximum rows returned. Restart the scan to revisit unresolved entries.
    pub limit: NonZeroU16,
}

/// Mode selected from trusted activation/policy facts, never from client input or
/// purchasable plan names. Legacy analytics must not also enter new-policy settlement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialMode {
    /// Observe attempts without authorization, reservations, allocation or collection.
    /// This is not a financial exemption and cannot later authorize historical debt.
    TrackingOnly,
    /// Requires awaited financial authorization before every provider execution.
    Activated,
    /// Preserve existing analytics/legacy accounting without reconstructing debt.
    Legacy,
    /// Explicitly exempt traffic; analytics may still be recorded.
    NonFinancial(ExclusionReason),
}

/// Separate object-safe capability injected alongside `Arc<dyn UsageRecorder>`.
/// There is deliberately no successful no-op financial implementation.
#[derive(Clone)]
pub enum FinancialCapability {
    /// Host has not wired financial support; activated traffic must fail closed.
    Unavailable,
    /// Host-provided financial lifecycle facade.
    Available(Arc<dyn FinancialUsage>),
}

impl FinancialCapability {
    /// Select the financial path without silently treating unavailable support as
    /// authorization. `None` is possible only for an explicitly nonfinancial/legacy mode.
    pub fn for_mode(&self, mode: FinancialMode) -> FinancialResult<Option<&dyn FinancialUsage>> {
        match (mode, self) {
            (
                FinancialMode::TrackingOnly
                | FinancialMode::Legacy
                | FinancialMode::NonFinancial(_),
                _,
            ) => Ok(None),
            (FinancialMode::Activated, Self::Unavailable) => {
                Err(FinancialError::CapabilityUnavailable)
            }
            (FinancialMode::Activated, Self::Available(service)) => Ok(Some(service.as_ref())),
        }
    }
}

/// Which immutable write was contradicted by a replay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayPhase {
    /// Admission context, model or budget changed.
    Begin,
    /// Provider evidence changed.
    Finalize,
}

/// Financial lifecycle failures. No error authorizes provider execution.
#[derive(Debug, Error)]
pub enum FinancialError {
    /// Missing mandatory financial wiring for activated traffic.
    #[error("financial capability unavailable")]
    CapabilityUnavailable,
    /// No applicable immutable financial rate; analytics prices are not a fallback.
    #[error("immutable financial rate unavailable")]
    RateUnavailable,
    /// Rate belongs to a different qualified model.
    #[error("financial rate provider/model mismatch")]
    RateModelMismatch,
    /// Funding domain refused the attempt (allowance/credit/cap/eligibility policy).
    #[error("funding authorization denied")]
    FundingDenied,
    /// Finalization referenced an invocation that was never begun.
    #[error("invocation not found")]
    InvocationNotFound,
    /// Invalid identifier shape or nil stable ID.
    #[error("invalid financial identifier")]
    InvalidIdentifier,
    /// Inclusive totals cannot contain the claimed cache/reasoning counts.
    #[error("inconsistent token usage")]
    InvalidTokenUsage,
    /// Financial operations never wrap, saturate, or permit negative balances.
    #[error("financial arithmetic overflow or underflow")]
    ArithmeticOverflow,
    /// Unsupported precision must not be rounded away silently.
    #[error("financial amount is below supported precision")]
    InsufficientPrecision,
    /// Invalid rational multiplier.
    #[error("financial ratio denominator must be nonzero")]
    ZeroDenominator,
    /// An ID was reused with different immutable facts.
    #[error("conflicting {phase:?} replay for invocation {invocation_id:?}")]
    ReplayConflict {
        /// Conflicting invocation identity.
        invocation_id: InvocationId,
        /// Conflicting stage.
        phase: ReplayPhase,
    },
    /// Adapter failure, retaining the original error report.
    #[error("financial infrastructure error: {0}")]
    Infrastructure(rootcause::Report),
}

/// Result type for financial contracts, separate from best-effort analytics errors.
pub type FinancialResult<T> = Result<T, FinancialError>;
