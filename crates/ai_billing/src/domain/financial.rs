//! Durable credit-first funding. The usage journal calls this owning-domain service;
//! only its acknowledged authorization permits execution. Repository transactions run
//! the pure policy transitions under the same payer lock as legacy settlement.

use ai_usage::domain::financial::*;
use ai_usage::domain::financial_service::validate_final_record;
use ai_usage::domain::ports::{FinancialFuture, InvocationFunding};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{BillingPeriod, NON_BILLABLE_AI_FEATURES, UsagePolicy};
use super::policy::{FundingAvailability, PolicyError, UsageAllocation};
use super::ports::FundingRepo;

#[cfg(test)]
mod test;

/// Verified subscription identity, not a product label, role or purchasable tier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FundingSubscription(String);

impl FundingSubscription {
    /// Validate a durable identity received from the subscription owner.
    pub fn new(value: String) -> FinancialResult<Self> {
        if value.is_empty() || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(FinancialError::InvalidIdentifier);
        }
        Ok(Self(value))
    }

    /// Persistence representation.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Immutable seat/payer/period policy binding. The period synchronization use case
/// must verify eligibility and prospective effective dates before publishing it.
/// No default, current role, or inferred calendar period can authorize V1 traffic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FundingPeriod {
    /// Seat owns its allowance even after leaving/rejoining a team.
    pub seat: MacroUserIdStr<'static>,
    /// Payer owns shared credits and caps.
    pub payer: MacroUserIdStr<'static>,
    /// Verified subscription identity, retained historically.
    pub subscription: FundingSubscription,
    /// Verified half-open interval, never an extrapolated anchor.
    pub period: BillingPeriod,
    /// Policy selected prospectively for this particular seat.
    pub policy: UsagePolicy,
}

impl FundingPeriod {
    /// Reject ambiguous timestamp precision and invalid intervals.
    pub fn validate(&self) -> FinancialResult<()> {
        if self.period.start >= self.period.end
            || !self
                .period
                .start
                .timestamp_subsec_nanos()
                .is_multiple_of(1000)
            || !self
                .period
                .end
                .timestamp_subsec_nanos()
                .is_multiple_of(1000)
        {
            return Err(FinancialError::FundingDenied);
        }
        Ok(())
    }
}

/// Exact reserved/spent credits outside the existing whole-cent ledger.
#[derive(Debug, Clone, Copy)]
pub struct CreditCommitments {
    /// Fraction of consumption not yet debited as a whole cent.
    pub remainder: CustomerMoney,
    /// Outstanding exclusive prepaid holds.
    pub held: CustomerMoney,
    /// Earlier releases still reserved for eligible pending attempts.
    pub release_pool: CustomerMoney,
}

impl CreditCommitments {
    /// Exact credits available to new admissions; no rounded fraction is restored.
    pub fn available(self, ledger_cents: i64) -> FinancialResult<CustomerMoney> {
        let balance = CustomerMoney::from_cents(ledger_cents.max(0) as u64)?;
        let committed = self
            .remainder
            .checked_add(self.held)?
            .checked_add(self.release_pool)?;
        Ok(CustomerMoney::from_units(
            balance.units().saturating_sub(committed.units()),
        ))
    }

    /// Whole cents legacy settlement may spend without touching fractional money,
    /// pending holds, or releases owed to earlier admissions.
    pub fn legacy_available_cents(self, ledger_cents: i64) -> FinancialResult<i64> {
        i64::try_from(self.available(ledger_cents)?.split_cents().whole_cents)
            .map_err(|_| FinancialError::ArithmeticOverflow)
    }
}

/// Consume once, debiting only new whole cents and retaining the exact remainder.
/// The debit, allocation, released holds and watermark must commit atomically.
pub fn prepaid_debit(
    remainder: CustomerMoney,
    consumed: CustomerMoney,
) -> FinancialResult<(i64, CustomerMoney)> {
    let parts = remainder.checked_add(consumed)?.split_cents();
    Ok((
        i64::try_from(parts.whole_cents).map_err(|_| FinancialError::ArithmeticOverflow)?,
        CustomerMoney::from_units(parts.subcent_units),
    ))
}

/// Preserve shared cap semantics with legacy seats on the same payer/period.
/// Round commitments up only for legacy's whole-cent admission, not customer billing.
pub fn legacy_cap_remaining(limit_cents: i64, committed: CustomerMoney) -> i64 {
    let parts = committed.split_cents();
    let unavailable = parts.whole_cents + u64::from(parts.subcent_units != 0);
    limit_cents
        .saturating_sub(i64::try_from(unavailable).unwrap_or(i64::MAX))
        .max(0)
}

/// Convert policy errors without granting any execution on failure.
pub fn funding_error(error: PolicyError) -> FinancialError {
    match error {
        PolicyError::Arithmetic(error) => error,
        _ => FinancialError::FundingDenied,
    }
}

/// Owning-domain facade injected into `ai_usage::FinancialUsageService`.
/// The journal pins intent before calling authorize and retries its durable handoff
/// after finalize. Funding writes are idempotent on invocation ID, including a lost
/// acknowledgement; no adapter imports another domain's outbound implementation.
pub struct FundingService<R> {
    repo: R,
}

impl<R: FundingRepo> FundingService<R> {
    /// Composition roots construct the repository and inject it here.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    /// Recorded policy at occurrence time; absence preserves the legacy path.
    pub async fn period(
        &self,
        seat: MacroUserIdStr<'static>,
        at: DateTime<Utc>,
    ) -> FinancialResult<Option<FundingPeriod>> {
        self.repo.period(seat, at).await
    }

    /// Publish only verified prospective facts from the period synchronization use case.
    pub async fn record_period(&self, period: FundingPeriod) -> FinancialResult<()> {
        period.validate()?;
        self.repo.record_period(period).await
    }

    /// Exact immutable source allocation, or None while evidence/order is unresolved.
    pub async fn allocation(&self, id: InvocationId) -> FinancialResult<Option<UsageAllocation>> {
        self.repo.allocation(id).await
    }

    /// Restart-safe discovery of outstanding authorizations and blocked allocation work.
    pub async fn pending(&self, query: PendingInvocations) -> FinancialResult<Vec<InvocationId>> {
        self.repo.pending(query).await
    }

    /// Continue bounded reconciliation after a crash or a large completion backlog.
    pub async fn reconcile(&self, payer: MacroUserIdStr<'static>) -> FinancialResult<()> {
        self.repo.reconcile(payer).await
    }
}

impl<R: FundingRepo> InvocationFunding for FundingService<R> {
    fn authorize(
        &self,
        request: BeginInvocation,
        rate: RateSnapshot,
    ) -> FinancialFuture<'_, FundingAuthorization> {
        Box::pin(async move {
            rate.require_model(&request.model)?;
            if NON_BILLABLE_AI_FEATURES.contains(&request.feature) {
                return Err(FinancialError::FundingDenied);
            }
            rate.tokens.price(request.token_budget)?;
            self.repo.authorize(request, rate).await
        })
    }

    fn finalize(&self, record: InvocationRecord) -> FinancialFuture<'_, ()> {
        Box::pin(async move {
            validate_final_record(&record)?;
            // This facade only admits V1 billable traffic. A later exclusion cannot
            // release incurred charges or turn missing provider evidence into zero.
            if matches!(record.state, InvocationState::Excluded { .. }) {
                return Err(FinancialError::FundingDenied);
            }
            self.repo.finalize(record).await
        })
    }
}

/// Derive admission capacity from exact repository facts under the payer lock.
/// The legacy charged amount already includes collectible/pending legacy invoices.
pub fn funding_availability(
    mut available: FundingAvailability,
    ledger_cents: i64,
    credits: CreditCommitments,
    legacy_charged_cents: i64,
) -> FinancialResult<FundingAvailability> {
    available.prepaid_available = credits.available(ledger_cents)?;
    available.postpaid_incurred =
        available
            .postpaid_incurred
            .checked_add(CustomerMoney::from_cents(
                legacy_charged_cents.max(0) as u64
            )?)?;
    Ok(available)
}
