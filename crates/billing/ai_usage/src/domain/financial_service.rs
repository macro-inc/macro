//! Durable financial lifecycle. Funding policy remains in the injected owning domain.

use std::sync::Arc;

use chrono::{DateTime, Utc};

use super::financial::*;
use super::ports::{FinancialFuture, FinancialRateResolver, FinancialUsage, InvocationFunding};

#[cfg(test)]
mod test;

/// Durable pre-authorization intent. A crash here is recoverable without executing a provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedInvocation {
    /// Immutable request and execution ceiling.
    pub request: BeginInvocation,
    /// Rate pinned before requesting funding.
    pub rate: RateSnapshot,
    /// Present only after the funding acknowledgement was journaled.
    pub funding: Option<FundingAuthorization>,
}

/// Cache-write regime verified for this exact model and rate version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheWritePolicy {
    /// This model does not charge for cache writes.
    NotApplicable,
    /// Provider's documented default cache regime.
    ProviderDefault,
    /// Explicit five-minute cache writes.
    FiveMinutes,
    /// Explicit one-hour cache writes.
    OneHour,
}

/// Provider counter semantics verified by the publisher, before normalization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CounterSemantics {
    /// All five dimensions are already disjoint.
    Disjoint,
    /// Input includes cache buckets; output includes reasoning.
    InclusiveTotals,
    /// Only input includes its cache buckets.
    InputInclusive,
    /// Only output includes reasoning.
    OutputInclusive,
}

/// Reviewed rate provenance. Publication is trusted configuration, not an admin analytics edit.
/// Only one execution/cache regime may be enabled for a provider/model at a given time;
/// producers must match it or remain ineligible. No production rates are seeded implicitly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RatePublication {
    /// Immutable price facts returned to funding authorization.
    pub snapshot: RateSnapshot,
    /// Exclusive end of validity; expiration blocks admission until another rate is reviewed.
    pub valid_until: DateTime<Utc>,
    /// Public pricing document reference, never credentials or request/response content.
    pub source: String,
    /// When these price and counter semantics were verified.
    pub verified_at: DateTime<Utc>,
    /// Cache-write regime to which the price applies.
    pub cache_write_policy: CacheWritePolicy,
    /// Semantics used by trusted adapters to produce disjoint counters.
    pub counter_semantics: CounterSemantics,
}

impl RatePublication {
    /// Reject incomplete provenance and ambiguous sub-microsecond activation boundaries.
    pub fn validate(&self) -> FinancialResult<()> {
        if self.source.trim().is_empty()
            || self.source.len() > 2048
            || self.valid_until <= self.snapshot.effective_at
            || !self
                .snapshot
                .effective_at
                .timestamp_subsec_nanos()
                .is_multiple_of(1000)
            || !self
                .valid_until
                .timestamp_subsec_nanos()
                .is_multiple_of(1000)
        {
            return Err(FinancialError::RateUnavailable);
        }
        Ok(())
    }
}

/// Owning-domain immutable rate catalog. New versions are append-only; replay must be identical.
pub trait FinancialRateCatalog: FinancialRateResolver {
    /// Publish reviewed facts; version or effective-time conflicts fail, never overwrite.
    fn publish(&self, publication: RatePublication) -> FinancialFuture<'_, WriteDisposition>;
    /// Retrieve the provenance and semantics pinned by an authorization's rate version.
    fn publication(&self, version: RateVersion) -> FinancialFuture<'_, Option<RatePublication>>;
}

/// Journal storage port. All writes must be atomic and compare immutable facts on replay.
/// Implementations retain interrupted preparation and unacknowledged funding handoff work.
pub trait FinancialUsageRepo: Send + Sync {
    /// Pin request/rate before funding. Concurrent identical preparations return the winning rate.
    fn prepare(
        &self,
        request: BeginInvocation,
        rate: RateSnapshot,
    ) -> FinancialFuture<'_, PreparedInvocation>;
    /// Fetch intent, including intents interrupted before authorization acknowledgement.
    fn prepared(&self, id: InvocationId) -> FinancialFuture<'_, Option<PreparedInvocation>>;
    /// Persist authorization; only the first acknowledgement returns `Inserted`.
    fn admit(
        &self,
        admission: AuthorizedInvocation,
    ) -> FinancialFuture<'_, Recorded<AuthorizedInvocation>>;
    /// Store a validated terminal state, atomically scheduling its funding handoff.
    fn finish(&self, record: InvocationRecord) -> FinancialFuture<'_, Recorded<InvocationRecord>>;
    /// Mark successful owning-domain handoff. Must not remove unresolved evidence from recovery.
    fn acknowledge_funding(&self, id: InvocationId) -> FinancialFuture<'_, ()>;
    /// Fetch admitted facts, not inferred usage or analytics rows.
    fn get(&self, id: InvocationId) -> FinancialFuture<'_, Option<InvocationRecord>>;
    /// Scan pending, unresolved, unpriced, and finalized-but-unacknowledged funding handoffs.
    fn pending(&self, query: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationRecord>>;
    /// Scan pinned intents without an acknowledged authorization; retry `begin`, never execution.
    fn pending_admissions(
        &self,
        query: PendingInvocations,
    ) -> FinancialFuture<'_, Vec<PreparedInvocation>>;
}

/// Awaited financial facade. Composition roots inject owning-domain capabilities.
pub struct FinancialUsageService {
    repo: Arc<dyn FinancialUsageRepo>,
    rates: Arc<dyn FinancialRateResolver>,
    funding: Arc<dyn InvocationFunding>,
}

impl FinancialUsageService {
    /// Construct without introducing an ai_usage dependency on the billing implementation.
    pub fn new(
        repo: Arc<dyn FinancialUsageRepo>,
        rates: Arc<dyn FinancialRateResolver>,
        funding: Arc<dyn InvocationFunding>,
    ) -> Self {
        Self {
            repo,
            rates,
            funding,
        }
    }

    /// Restart-safe discovery of crashes between pinning rates and journaling authorization.
    /// Recovery may retry admission, but must not execute the provider for an abandoned intent.
    pub async fn pending_admissions(
        &self,
        query: PendingInvocations,
    ) -> FinancialResult<Vec<PreparedInvocation>> {
        self.repo.pending_admissions(query).await
    }
}

impl FinancialUsage for FinancialUsageService {
    fn begin(
        &self,
        request: BeginInvocation,
    ) -> FinancialFuture<'_, Recorded<AuthorizedInvocation>> {
        Box::pin(async move {
            let prepared = match self.repo.prepared(request.invocation_id).await? {
                Some(prepared) => {
                    prepared.request.check_replay(&request)?;
                    prepared
                }
                None => {
                    let rate = self
                        .rates
                        .resolve(request.model.clone(), request.occurred_at)
                        .await?;
                    rate.require_model(&request.model)?;
                    // Reject an unrepresentable reservation before any funding write.
                    rate.tokens.price(request.token_budget)?;
                    self.repo.prepare(request, rate).await?
                }
            };
            if let Some(funding) = prepared.funding {
                return Ok(Recorded {
                    value: AuthorizedInvocation {
                        request: prepared.request,
                        rate: prepared.rate,
                        funding,
                    },
                    disposition: WriteDisposition::Replayed,
                });
            }
            let required_budget = prepared.rate.tokens.price(prepared.request.token_budget)?;
            let funding = self
                .funding
                .authorize(prepared.request.clone(), prepared.rate.clone())
                .await?;
            if funding.invocation_id != prepared.request.invocation_id
                || funding.maximum_public_usage < required_budget
            {
                return Err(FinancialError::FundingDenied);
            }
            self.repo
                .admit(AuthorizedInvocation {
                    request: prepared.request,
                    rate: prepared.rate,
                    funding,
                })
                .await
        })
    }

    fn finalize(
        &self,
        evidence: FinalizeInvocation,
    ) -> FinancialFuture<'_, Recorded<InvocationRecord>> {
        Box::pin(async move {
            let existing = self
                .repo
                .get(evidence.invocation_id)
                .await?
                .ok_or(FinancialError::InvocationNotFound)?;
            let state = price_evidence(&existing.admission.rate, evidence)?;
            let recorded = self
                .repo
                .finish(InvocationRecord {
                    admission: existing.admission,
                    state,
                })
                .await?;
            // Evidence commits first. Failure here remains discoverable in pending(), even for
            // priced records. The funding owner deduplicates a lost acknowledgement.
            self.funding.finalize(recorded.value.clone()).await?;
            self.repo
                .acknowledge_funding(recorded.value.admission.request.invocation_id)
                .await?;
            Ok(recorded)
        })
    }

    fn get(&self, id: InvocationId) -> FinancialFuture<'_, Option<InvocationRecord>> {
        self.repo.get(id)
    }

    fn pending(&self, query: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationRecord>> {
        self.repo.pending(query)
    }
}

fn price_evidence(
    rate: &RateSnapshot,
    evidence: FinalizeInvocation,
) -> FinancialResult<InvocationState> {
    match evidence.usage {
        UsageEvidence::Missing(_) => Ok(InvocationState::Unresolved { evidence }),
        UsageEvidence::Reported(tokens) => match rate.tokens.price(tokens) {
            Ok(public_usage) => Ok(InvocationState::Priced {
                evidence,
                public_usage,
            }),
            Err(FinancialError::ArithmeticOverflow) => Ok(InvocationState::Unpriced {
                evidence,
                reason: UnpricedReason::ArithmeticOverflow,
            }),
            Err(error) => Err(error),
        },
    }
}

/// Enforce terminal state invariants at the repository boundary as well as in the facade.
/// An excluded state must come from a trusted policy caller, never from missing capability.
pub fn validate_final_record(record: &InvocationRecord) -> FinancialResult<()> {
    let evidence = match &record.state {
        InvocationState::Pending => return Err(FinancialError::InvalidTokenUsage),
        InvocationState::Priced { evidence, .. }
        | InvocationState::Unpriced { evidence, .. }
        | InvocationState::Unresolved { evidence }
        | InvocationState::Excluded { evidence, .. } => evidence,
    };
    if evidence.invocation_id != record.admission.request.invocation_id {
        return Err(FinancialError::ReplayConflict {
            invocation_id: record.admission.request.invocation_id,
            phase: ReplayPhase::Finalize,
        });
    }
    if !matches!(record.state, InvocationState::Excluded { .. })
        && price_evidence(&record.admission.rate, evidence.clone())? != record.state
    {
        return Err(FinancialError::InvalidTokenUsage);
    }
    Ok(())
}
