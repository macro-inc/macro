use super::*;
use crate::domain::{
    AiFeature, CompletionUsage, ModelPricing, Price, SYSTEM_USER_ID, Usage, UsageAmount,
    UsageApiParams, UsageRepo,
};
use crate::outbound::PgUsageRepo;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn publication() -> RatePublication {
    let effective_at = DateTime::from_timestamp(1_800_000_000, 0).unwrap();
    RatePublication {
        snapshot: RateSnapshot {
            version: RateVersion::new(),
            model: ProviderModel::new("test-provider", "test-model").unwrap(),
            effective_at,
            tokens: TokenRates {
                input: 1_000_000,
                output: 2_000_000,
                cache_read: 100_000,
                cache_write: 1_250_000,
                reasoning: 2_000_000,
            },
        },
        valid_until: effective_at + Duration::days(30),
        source: "https://example.com/public-prices".into(),
        verified_at: effective_at,
        cache_write_policy: CacheWritePolicy::FiveMinutes,
        counter_semantics: CounterSemantics::InclusiveTotals,
    }
}

fn request(rate: &RateSnapshot) -> BeginInvocation {
    BeginInvocation {
        run_id: RunId::new(),
        invocation_id: InvocationId::new(),
        user: SYSTEM_USER_ID.clone(),
        feature: AiFeature::Chat,
        entity: None,
        model: rate.model.clone(),
        // Preserve exact nanoseconds through evidence replay despite timestamptz precision.
        occurred_at: rate.effective_at + Duration::nanoseconds(123_456_789),
        token_budget: TrustedTokenUsage::from_disjoint(100, 50, 40, 30, 20),
    }
}

fn admission(request: BeginInvocation, rate: RateSnapshot) -> AuthorizedInvocation {
    let funding = FundingAuthorization {
        id: FundingAuthorizationId::new(),
        invocation_id: request.invocation_id,
        maximum_public_usage: rate.tokens.price(request.token_budget).unwrap(),
    };
    AuthorizedInvocation {
        request,
        rate,
        funding,
    }
}

fn record(admission: AuthorizedInvocation) -> InvocationRecord {
    let usage = TrustedTokenUsage::from_inclusive_totals(100, 50, 40, 30, 20).unwrap();
    let evidence = FinalizeInvocation {
        invocation_id: admission.request.invocation_id,
        occurred_at: admission.request.occurred_at + Duration::seconds(1),
        provider_request_id: Some(ProviderRequestId::new("provider-request-id").unwrap()),
        outcome: ProviderOutcome::Cancelled,
        usage: UsageEvidence::Reported(usage),
    };
    let public_usage = admission.rate.tokens.price(usage).unwrap();
    InvocationRecord {
        admission,
        state: InvocationState::Priced {
            evidence,
            public_usage,
        },
    }
}

fn scan() -> PendingInvocations {
    PendingInvocations {
        after: None,
        before: publication().valid_until,
        limit: 100.try_into().unwrap(),
    }
}

async fn prepare(repo: &PgFinancialUsageRepo) -> AuthorizedInvocation {
    let publication = publication();
    repo.publish(publication.clone()).await.unwrap();
    let request = request(&publication.snapshot);
    repo.prepare(request.clone(), publication.snapshot.clone())
        .await
        .unwrap();
    admission(request, publication.snapshot)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rate_publications_are_immutable_qualified_and_expire_closed(pool: PgPool) {
    let repo = PgFinancialUsageRepo::new(pool.clone());
    let original = publication();
    assert_eq!(
        repo.publish(original.clone()).await.unwrap(),
        WriteDisposition::Inserted
    );
    assert_eq!(
        repo.publish(original.clone()).await.unwrap(),
        WriteDisposition::Replayed
    );
    let mut changed = original.clone();
    changed.snapshot.tokens.input += 1;
    assert!(repo.publish(changed).await.is_err());
    assert_eq!(
        repo.publication(original.snapshot.version).await.unwrap(),
        Some(original.clone())
    );
    assert!(matches!(
        repo.resolve(
            ProviderModel::new("other", "test-model").unwrap(),
            original.snapshot.effective_at
        )
        .await,
        Err(FinancialError::RateUnavailable)
    ));
    let mut other_provider = original.clone();
    other_provider.snapshot.version = RateVersion::new();
    other_provider.snapshot.model = ProviderModel::new("other", "test-model").unwrap();
    other_provider.snapshot.tokens.input += 10;
    repo.publish(other_provider.clone()).await.unwrap();
    assert_eq!(
        repo.resolve(
            other_provider.snapshot.model.clone(),
            original.snapshot.effective_at
        )
        .await
        .unwrap(),
        other_provider.snapshot
    );
    assert!(
        repo.resolve(
            original.snapshot.model.clone(),
            original.snapshot.effective_at - Duration::microseconds(1)
        )
        .await
        .is_err()
    );
    let mut replacement = original.clone();
    replacement.snapshot.version = RateVersion::new();
    replacement.snapshot.effective_at += Duration::days(1);
    replacement.valid_until = replacement.snapshot.effective_at + Duration::days(1);
    repo.publish(replacement.clone()).await.unwrap();
    assert_eq!(
        repo.resolve(
            original.snapshot.model.clone(),
            replacement.snapshot.effective_at
        )
        .await
        .unwrap(),
        replacement.snapshot
    );
    assert!(matches!(
        repo.resolve(original.snapshot.model.clone(), replacement.valid_until)
            .await,
        Err(FinancialError::RateUnavailable)
    ));
    // A different UUID cannot introduce an ambiguous version for the same effective time.
    let mut collision = original.clone();
    collision.snapshot.version = RateVersion::new();
    assert!(repo.publish(collision).await.is_err());
    assert!(
        sqlx::query!(
            "UPDATE ai_financial_rate SET model = 'mutated' WHERE version = $1",
            original.snapshot.version.as_uuid()
        )
        .execute(&pool)
        .await
        .is_err()
    );
    assert!(
        sqlx::query!(
            "DELETE FROM ai_financial_rate WHERE version = $1",
            original.snapshot.version.as_uuid()
        )
        .execute(&pool)
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lost_acknowledgements_and_concurrent_replays_write_once(pool: PgPool) {
    let repo = PgFinancialUsageRepo::new(pool);
    let admission = prepare(&repo).await;
    let id = admission.request.invocation_id;
    assert!(repo.get(id).await.unwrap().is_none());
    assert_eq!(repo.pending_admissions(scan()).await.unwrap().len(), 1);
    let (left, right) = tokio::join!(repo.admit(admission.clone()), repo.admit(admission.clone()));
    let results = [left.unwrap(), right.unwrap()];
    assert_eq!(
        results
            .iter()
            .filter(|result| result.disposition == WriteDisposition::Inserted)
            .count(),
        1
    );
    assert_eq!(
        repo.admit(admission.clone()).await.unwrap().disposition,
        WriteDisposition::Replayed
    );
    assert!(repo.pending_admissions(scan()).await.unwrap().is_empty());
    assert_eq!(
        repo.pending(scan()).await.unwrap()[0].state,
        InvocationState::Pending
    );
    let record = record(admission);
    let (left, right) = tokio::join!(repo.finish(record.clone()), repo.finish(record.clone()));
    let results = [left.unwrap(), right.unwrap()];
    assert_eq!(
        results
            .iter()
            .filter(|result| result.disposition == WriteDisposition::Inserted)
            .count(),
        1
    );
    // Crash after evidence commit is still discoverable for funding handoff.
    assert_eq!(repo.pending(scan()).await.unwrap(), vec![record.clone()]);
    assert_eq!(repo.get(id).await.unwrap(), Some(record.clone()));
    repo.acknowledge_funding(id).await.unwrap();
    repo.acknowledge_funding(id).await.unwrap();
    assert!(repo.pending(scan()).await.unwrap().is_empty());
    assert_eq!(
        repo.finish(record).await.unwrap().disposition,
        WriteDisposition::Replayed
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn conflicting_replays_and_direct_mutation_cannot_replace_facts(pool: PgPool) {
    let repo = PgFinancialUsageRepo::new(pool.clone());
    let admission = prepare(&repo).await;
    repo.admit(admission.clone()).await.unwrap();
    let mut changed = admission.request.clone();
    changed.user = MacroUserIdStr::try_from("macro|other@example.com".to_owned()).unwrap();
    assert!(matches!(
        repo.prepare(changed, admission.rate.clone()).await,
        Err(FinancialError::ReplayConflict {
            phase: ReplayPhase::Begin,
            ..
        })
    ));
    let mut changed_funding = admission.clone();
    changed_funding.funding.id = FundingAuthorizationId::new();
    assert!(matches!(
        repo.admit(changed_funding).await,
        Err(FinancialError::ReplayConflict {
            phase: ReplayPhase::Begin,
            ..
        })
    ));
    let original = record(admission.clone());
    repo.finish(original.clone()).await.unwrap();
    let mut changed = original.clone();
    if let InvocationState::Priced { evidence, .. } = &mut changed.state {
        evidence.outcome = ProviderOutcome::Succeeded;
    }
    assert!(matches!(
        repo.finish(changed).await,
        Err(FinancialError::ReplayConflict {
            phase: ReplayPhase::Finalize,
            ..
        })
    ));
    let mut mispriced = original.clone();
    if let InvocationState::Priced { public_usage, .. } = &mut mispriced.state {
        *public_usage = PublicUsage::from_units(0);
    }
    assert!(matches!(
        repo.finish(mispriced).await,
        Err(FinancialError::InvalidTokenUsage)
    ));
    assert!(sqlx::query!("UPDATE ai_financial_invocation SET finalization = NULL, finalized_at = NULL WHERE invocation_id = $1", admission.request.invocation_id.as_uuid()).execute(&pool).await.is_err());
    assert!(
        sqlx::query!(
            "UPDATE ai_financial_invocation SET request = '{}'::jsonb WHERE invocation_id = $1",
            admission.request.invocation_id.as_uuid()
        )
        .execute(&pool)
        .await
        .is_err()
    );
    assert_eq!(
        repo.get(admission.request.invocation_id).await.unwrap(),
        Some(original)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn interrupted_and_unpriced_invocations_remain_recoverable_with_bounded_scans(pool: PgPool) {
    let repo = PgFinancialUsageRepo::new(pool);
    let first = prepare(&repo).await;
    repo.admit(first.clone()).await.unwrap();
    let mut second_request = first.request.clone();
    second_request.invocation_id = InvocationId::new();
    repo.prepare(second_request.clone(), first.rate.clone())
        .await
        .unwrap();
    let second = admission(second_request, first.rate.clone());
    repo.admit(second.clone()).await.unwrap();
    let missing = InvocationRecord {
        admission: first.clone(),
        state: InvocationState::Unresolved {
            evidence: FinalizeInvocation {
                invocation_id: first.request.invocation_id,
                occurred_at: first.request.occurred_at,
                provider_request_id: None,
                outcome: ProviderOutcome::Unknown,
                usage: UsageEvidence::Missing(UnresolvedReason::Interrupted),
            },
        },
    };
    repo.finish(missing.clone()).await.unwrap();
    repo.acknowledge_funding(first.request.invocation_id)
        .await
        .unwrap();
    let overflow = InvocationRecord {
        admission: second.clone(),
        state: InvocationState::Unpriced {
            evidence: FinalizeInvocation {
                invocation_id: second.request.invocation_id,
                occurred_at: second.request.occurred_at,
                provider_request_id: None,
                outcome: ProviderOutcome::Failed,
                usage: UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(
                    u64::MAX,
                    0,
                    0,
                    0,
                    0,
                )),
            },
            reason: UnpricedReason::ArithmeticOverflow,
        },
    };
    repo.finish(overflow.clone()).await.unwrap();
    repo.acknowledge_funding(second.request.invocation_id)
        .await
        .unwrap();
    assert_eq!(
        repo.get(second.request.invocation_id).await.unwrap(),
        Some(overflow)
    );
    assert_eq!(repo.pending(scan()).await.unwrap().len(), 2);
    let mut query = scan();
    query.limit = 1.try_into().unwrap();
    let page = repo.pending(query).await.unwrap();
    assert_eq!(page.len(), 1);
    query.after = Some(page[0].admission.request.invocation_id);
    assert_eq!(repo.pending(query).await.unwrap().len(), 1);
    query.before = first.rate.effective_at;
    assert!(repo.pending(query).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_analytics_writes_and_repricing_leave_financial_evidence_unchanged(pool: PgPool) {
    let repo = PgFinancialUsageRepo::new(pool.clone());
    let admission = prepare(&repo).await;
    repo.admit(admission.clone()).await.unwrap();
    let original = record(admission.clone());
    repo.finish(original.clone()).await.unwrap();
    let analytics = PgUsageRepo::new(pool);
    let pricing = ModelPricing::Tokens {
        input: 1.0,
        output: 2.0,
    };
    let amount = UsageAmount::Tokens {
        input: 1_000_000,
        output: 0,
    };
    analytics
        .insert_usage(&CompletionUsage {
            feature: AiFeature::Chat,
            user: SYSTEM_USER_ID.clone(),
            entity: None,
            cost: Usage {
                amount,
                model: "test-model".into(),
                price: Price::compute(pricing, amount),
                created_at: Utc::now(),
            },
        })
        .await
        .unwrap();
    analytics
        .set_pricing(
            "test-model",
            ModelPricing::Tokens {
                input: 99.0,
                output: 99.0,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        analytics
            .query_usage(&UsageApiParams::default())
            .await
            .unwrap()[0]
            .cost
            .price
            .unwrap()
            .total,
        99.0
    );
    assert_eq!(
        repo.get(admission.request.invocation_id).await.unwrap(),
        Some(original)
    );
    assert_eq!(
        repo.resolve(admission.rate.model.clone(), admission.request.occurred_at)
            .await
            .unwrap(),
        admission.rate
    );
}
