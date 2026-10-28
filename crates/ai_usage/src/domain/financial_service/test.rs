use super::*;
use crate::domain::{AiFeature, SYSTEM_USER_ID};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

fn request() -> BeginInvocation {
    BeginInvocation {
        run_id: RunId::new(),
        invocation_id: InvocationId::new(),
        user: SYSTEM_USER_ID.clone(),
        feature: AiFeature::Chat,
        entity: None,
        model: ProviderModel::new("provider", "model").unwrap(),
        occurred_at: Utc::now(),
        token_budget: TrustedTokenUsage::from_disjoint(100, 20, 0, 0, 0),
    }
}

fn rate(request: &BeginInvocation) -> RateSnapshot {
    RateSnapshot {
        version: RateVersion::new(),
        model: request.model.clone(),
        effective_at: request.occurred_at,
        tokens: TokenRates {
            input: 1,
            output: 2,
            cache_read: 1,
            cache_write: 3,
            reasoning: 2,
        },
    }
}

fn evidence(id: InvocationId, usage: UsageEvidence) -> FinalizeInvocation {
    FinalizeInvocation {
        invocation_id: id,
        occurred_at: Utc::now(),
        provider_request_id: None,
        outcome: ProviderOutcome::Failed,
        usage,
    }
}

#[derive(Default)]
struct Repo {
    prepared: Mutex<Option<PreparedInvocation>>,
    record: Mutex<Option<InvocationRecord>>,
    acknowledged: AtomicBool,
}

impl FinancialUsageRepo for Repo {
    fn prepare(
        &self,
        request: BeginInvocation,
        rate: RateSnapshot,
    ) -> FinancialFuture<'_, PreparedInvocation> {
        Box::pin(async move {
            let mut slot = self.prepared.lock().unwrap();
            if let Some(existing) = slot.as_ref() {
                existing.request.check_replay(&request)?;
                return Ok(existing.clone());
            }
            let prepared = PreparedInvocation {
                request,
                rate,
                funding: None,
            };
            *slot = Some(prepared.clone());
            Ok(prepared)
        })
    }
    fn prepared(&self, _: InvocationId) -> FinancialFuture<'_, Option<PreparedInvocation>> {
        Box::pin(async { Ok(self.prepared.lock().unwrap().clone()) })
    }
    fn admit(
        &self,
        admission: AuthorizedInvocation,
    ) -> FinancialFuture<'_, Recorded<AuthorizedInvocation>> {
        Box::pin(async move {
            let mut prepared = self.prepared.lock().unwrap();
            let prepared = prepared.as_mut().unwrap();
            prepared.request.check_replay(&admission.request)?;
            let disposition = if prepared.funding.is_some() {
                WriteDisposition::Replayed
            } else {
                WriteDisposition::Inserted
            };
            prepared.funding = Some(admission.funding.clone());
            *self.record.lock().unwrap() = Some(InvocationRecord {
                admission: admission.clone(),
                state: InvocationState::Pending,
            });
            Ok(Recorded {
                value: admission,
                disposition,
            })
        })
    }
    fn finish(&self, record: InvocationRecord) -> FinancialFuture<'_, Recorded<InvocationRecord>> {
        Box::pin(async move {
            validate_final_record(&record)?;
            let mut slot = self.record.lock().unwrap();
            let existing = slot.as_ref().unwrap();
            let disposition = if existing.state == InvocationState::Pending {
                WriteDisposition::Inserted
            } else {
                if existing != &record {
                    return Err(FinancialError::ReplayConflict {
                        invocation_id: record.admission.request.invocation_id,
                        phase: ReplayPhase::Finalize,
                    });
                }
                WriteDisposition::Replayed
            };
            *slot = Some(record.clone());
            Ok(Recorded {
                value: record,
                disposition,
            })
        })
    }
    fn acknowledge_funding(&self, _: InvocationId) -> FinancialFuture<'_, ()> {
        Box::pin(async {
            self.acknowledged.store(true, Ordering::SeqCst);
            Ok(())
        })
    }
    fn get(&self, _: InvocationId) -> FinancialFuture<'_, Option<InvocationRecord>> {
        Box::pin(async { Ok(self.record.lock().unwrap().clone()) })
    }
    fn pending(&self, _: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationRecord>> {
        Box::pin(async {
            Ok(self
                .record
                .lock()
                .unwrap()
                .iter()
                .filter(|record| {
                    !self.acknowledged.load(Ordering::SeqCst)
                        || matches!(
                            record.state,
                            InvocationState::Pending
                                | InvocationState::Unresolved { .. }
                                | InvocationState::Unpriced { .. }
                        )
                })
                .cloned()
                .collect())
        })
    }
    fn pending_admissions(
        &self,
        _: PendingInvocations,
    ) -> FinancialFuture<'_, Vec<PreparedInvocation>> {
        Box::pin(async {
            Ok(self
                .prepared
                .lock()
                .unwrap()
                .iter()
                .filter(|p| p.funding.is_none())
                .cloned()
                .collect())
        })
    }
}

struct Rates(Mutex<Option<RateSnapshot>>);
impl FinancialRateResolver for Rates {
    fn resolve(&self, _: ProviderModel, _: DateTime<Utc>) -> FinancialFuture<'_, RateSnapshot> {
        Box::pin(async {
            self.0
                .lock()
                .unwrap()
                .clone()
                .ok_or(FinancialError::RateUnavailable)
        })
    }
}

#[derive(Default)]
struct Funding {
    deny: AtomicBool,
    fail_handoff: AtomicBool,
    authorizations: AtomicUsize,
    handoffs: AtomicUsize,
}
impl InvocationFunding for Funding {
    fn authorize(
        &self,
        request: BeginInvocation,
        rate: RateSnapshot,
    ) -> FinancialFuture<'_, FundingAuthorization> {
        Box::pin(async move {
            self.authorizations.fetch_add(1, Ordering::SeqCst);
            if self.deny.load(Ordering::SeqCst) {
                return Err(FinancialError::FundingDenied);
            }
            Ok(FundingAuthorization {
                id: FundingAuthorizationId::new(),
                invocation_id: request.invocation_id,
                maximum_public_usage: rate.tokens.price(request.token_budget)?,
            })
        })
    }
    fn finalize(&self, _: InvocationRecord) -> FinancialFuture<'_, ()> {
        Box::pin(async {
            self.handoffs.fetch_add(1, Ordering::SeqCst);
            if self.fail_handoff.load(Ordering::SeqCst) {
                return Err(FinancialError::FundingDenied);
            }
            Ok(())
        })
    }
}

fn scan() -> PendingInvocations {
    PendingInvocations {
        after: None,
        before: Utc::now(),
        limit: 10.try_into().unwrap(),
    }
}

#[tokio::test]
async fn unknown_rate_never_authorizes_and_denied_admission_retains_pinned_rate() {
    let request = request();
    let original_rate = rate(&request);
    let repo = Arc::new(Repo::default());
    let rates = Arc::new(Rates(Mutex::new(None)));
    let funding = Arc::new(Funding::default());
    let service = FinancialUsageService::new(repo.clone(), rates.clone(), funding.clone());
    assert!(matches!(
        service.begin(request.clone()).await,
        Err(FinancialError::RateUnavailable)
    ));
    assert_eq!(funding.authorizations.load(Ordering::SeqCst), 0);
    *rates.0.lock().unwrap() = Some(original_rate.clone());
    funding.deny.store(true, Ordering::SeqCst);
    assert!(matches!(
        service.begin(request.clone()).await,
        Err(FinancialError::FundingDenied)
    ));
    assert_eq!(service.pending_admissions(scan()).await.unwrap().len(), 1);
    // New publications or unavailable rates cannot change a previously pinned intent.
    *rates.0.lock().unwrap() = None;
    funding.deny.store(false, Ordering::SeqCst);
    let admitted = service.begin(request.clone()).await.unwrap();
    assert_eq!(admitted.value.rate, original_rate);
    assert_eq!(admitted.disposition, WriteDisposition::Inserted);
    assert!(service.pending_admissions(scan()).await.unwrap().is_empty());
    assert_eq!(
        service.begin(request.clone()).await.unwrap().disposition,
        WriteDisposition::Replayed
    );
    assert_eq!(funding.authorizations.load(Ordering::SeqCst), 2);
    let mut conflicting = request;
    conflicting.feature = AiFeature::Memory;
    assert!(matches!(
        service.begin(conflicting).await,
        Err(FinancialError::ReplayConflict {
            phase: ReplayPhase::Begin,
            ..
        })
    ));
}

#[tokio::test]
async fn lost_handoff_acknowledgement_leaves_priced_evidence_discoverable() {
    let request = request();
    let repo = Arc::new(Repo::default());
    let rates = Arc::new(Rates(Mutex::new(Some(rate(&request)))));
    let funding = Arc::new(Funding::default());
    let service = FinancialUsageService::new(repo, rates, funding.clone());
    service.begin(request.clone()).await.unwrap();
    let evidence = evidence(
        request.invocation_id,
        UsageEvidence::Reported(TrustedTokenUsage::from_inclusive_totals(10, 5, 2, 1, 2).unwrap()),
    );
    funding.fail_handoff.store(true, Ordering::SeqCst);
    assert!(service.finalize(evidence.clone()).await.is_err());
    let pending = service.pending(scan()).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert!(
        matches!(pending[0].state, InvocationState::Priced { public_usage, .. } if public_usage.units() == 22)
    );
    funding.fail_handoff.store(false, Ordering::SeqCst);
    assert_eq!(
        service
            .finalize(evidence.clone())
            .await
            .unwrap()
            .disposition,
        WriteDisposition::Replayed
    );
    assert!(service.pending(scan()).await.unwrap().is_empty());
    let mut conflict = evidence;
    conflict.outcome = ProviderOutcome::Succeeded;
    assert!(matches!(
        service.finalize(conflict).await,
        Err(FinancialError::ReplayConflict {
            phase: ReplayPhase::Finalize,
            ..
        })
    ));
    assert_eq!(funding.handoffs.load(Ordering::SeqCst), 2);
}

#[test]
fn missing_usage_and_overflow_are_preserved_not_zeroed() {
    let request = request();
    let rate = rate(&request);
    let missing = evidence(
        request.invocation_id,
        UsageEvidence::Missing(UnresolvedReason::Interrupted),
    );
    assert!(matches!(
        price_evidence(&rate, missing).unwrap(),
        InvocationState::Unresolved { .. }
    ));
    let overflow = evidence(
        request.invocation_id,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, u64::MAX, 0, 0, 0)),
    );
    assert!(matches!(
        price_evidence(&rate, overflow).unwrap(),
        InvocationState::Unpriced {
            reason: UnpricedReason::ArithmeticOverflow,
            ..
        }
    ));
    let zero = evidence(
        request.invocation_id,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0)),
    );
    assert!(
        matches!(price_evidence(&rate, zero).unwrap(), InvocationState::Priced { public_usage, .. } if public_usage.units() == 0)
    );
}
