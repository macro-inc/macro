use super::*;
use crate::domain::ports::{FinancialFuture, FinancialUsage, NoOpUsageRecorder, UsageRecorder};
use std::collections::HashMap;
use std::sync::Arc;

fn model(provider: &str) -> ProviderModel {
    ProviderModel::new(provider, "shared/model-name").unwrap()
}

fn rate(provider: &str) -> RateSnapshot {
    RateSnapshot {
        version: RateVersion::new(),
        model: model(provider),
        effective_at: Utc::now(),
        // Picodollars/token: $1, $2, $0.10, $1.25 and $2 per million.
        tokens: TokenRates {
            input: 1_000_000,
            output: 2_000_000,
            cache_read: 100_000,
            cache_write: 1_250_000,
            reasoning: 2_000_000,
        },
    }
}

fn begin() -> BeginInvocation {
    BeginInvocation {
        run_id: RunId::new(),
        invocation_id: InvocationId::new(),
        user: MacroUserIdStr::try_from("macro|test@example.com".to_owned()).unwrap(),
        feature: AiFeature::Chat,
        entity: None,
        model: model("provider-a"),
        occurred_at: Utc::now(),
        token_budget: TrustedTokenUsage::from_disjoint(10, 20, 0, 0, 0),
    }
}

fn finalize(invocation_id: InvocationId) -> FinalizeInvocation {
    FinalizeInvocation {
        invocation_id,
        occurred_at: Utc::now(),
        provider_request_id: Some(ProviderRequestId::new("request-123").unwrap()),
        outcome: ProviderOutcome::Succeeded,
        usage: UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(1, 2, 0, 0, 0)),
    }
}

#[test]
fn stable_ids_roundtrip_and_reject_nil() {
    let id = InvocationId::new();
    assert_eq!(id, InvocationId::try_from(id.as_uuid()).unwrap());
    assert_eq!(id.as_uuid().get_version_num(), 7);
    assert!(InvocationId::try_from(Uuid::nil()).is_err());
    assert_ne!(InvocationId::new(), id);
}

#[test]
fn qualified_models_do_not_collide_or_strip_nested_names() {
    let first = rate("provider-a");
    let second = rate("provider-b");
    let rates = HashMap::from([
        (first.model.clone(), first.version),
        (second.model.clone(), second.version),
    ]);
    assert_eq!(rates.len(), 2);
    assert_eq!(first.model.model(), "shared/model-name");
    assert!(first.require_model(&second.model).is_err());
    assert!(ProviderModel::new("", "model").is_err());
    assert!(ProviderModel::new("Provider-A", "model").is_err());
    assert!(ProviderModel::new("provider-a", " model ").is_err());
    assert!(ProviderRequestId::new("\n").is_err());
}

#[test]
fn pricing_preserves_fractional_cents_and_disjoint_dimensions() {
    let tokens = TrustedTokenUsage::from_inclusive_totals(100, 50, 20, 10, 5).unwrap();
    assert_eq!(tokens, TrustedTokenUsage::from_disjoint(70, 45, 20, 10, 5));
    let usage = rate("provider-a").tokens.price(tokens).unwrap();
    assert_eq!(usage.units(), 184_500_000);
    let money = CustomerMoney::from_public_ratio(usage, 105, 100).unwrap();
    assert_eq!(money.units(), 19_372_500_000);
    assert_eq!(money.split_cents().whole_cents, 0);
    assert_eq!(money.split_cents().subcent_units, money.units());
}

#[test]
fn rejects_inconsistent_inclusive_token_counts() {
    assert!(TrustedTokenUsage::from_inclusive_totals(5, 10, 4, 2, 0).is_err());
    assert!(TrustedTokenUsage::from_inclusive_totals(5, 10, 0, 0, 11).is_err());
    assert!(TrustedTokenUsage::from_inclusive_totals(u64::MAX, 0, u64::MAX, 1, 0).is_err());
}

#[test]
fn overflow_is_explicit_and_wider_intermediates_preserve_valid_results() {
    let max = PublicUsage::from_units(u64::MAX);
    assert!(max.checked_add(PublicUsage::from_units(1)).is_err());
    assert!(PublicUsage::from_units(0).checked_sub(max).is_err());
    assert!(CustomerMoney::from_cents(u64::MAX).is_err());
    assert!(
        CustomerMoney::from_units(u64::MAX)
            .checked_add(CustomerMoney::from_units(1))
            .is_err()
    );
    assert!(
        CustomerMoney::from_units(0)
            .checked_sub(CustomerMoney::from_units(1))
            .is_err()
    );
    assert!(CustomerMoney::from_public_ratio(max, 1, 1).is_err());
    // Multiplication exceeds u64 before division, but the final result fits.
    assert_eq!(
        CustomerMoney::from_public_ratio(max, 1, 100)
            .unwrap()
            .units(),
        u64::MAX
    );
    assert!(CustomerMoney::from_public_ratio(max, u64::MAX, 1).is_err());
    assert!(CustomerMoney::from_public_ratio(max, 1, 0).is_err());
    // Never silently discard precision below the money unit.
    assert!(CustomerMoney::from_public_ratio(PublicUsage::from_units(1), 1, 3).is_err());
    let rates = TokenRates {
        input: u64::MAX,
        output: u64::MAX,
        cache_read: 0,
        cache_write: 0,
        reasoning: 0,
    };
    assert!(
        rates
            .price(TrustedTokenUsage::from_disjoint(
                u64::MAX,
                u64::MAX,
                0,
                0,
                0
            ))
            .is_err()
    );
}

#[test]
fn subcent_parts_recombine_without_per_invocation_rounding() {
    let cent = CustomerMoney::from_cents(1).unwrap();
    let fraction = CustomerMoney::from_units(cent.units() / 4);
    let total = fraction
        .checked_add(fraction)
        .unwrap()
        .checked_add(fraction)
        .unwrap();
    assert_eq!(total.split_cents().whole_cents, 0);
    assert_eq!(
        total.checked_add(fraction).unwrap().split_cents(),
        CentParts {
            whole_cents: 1,
            subcent_units: 0
        }
    );
    let total = cent.checked_add(fraction).unwrap();
    let parts = total.split_cents();
    assert_eq!(
        CustomerMoney::from_cents(parts.whole_cents)
            .unwrap()
            .checked_add(CustomerMoney::from_units(parts.subcent_units))
            .unwrap(),
        total
    );
}

#[test]
fn replay_accepts_identical_evidence_but_rejects_changed_facts() {
    let request = begin();
    assert!(request.check_replay(&request.clone()).is_ok());
    let mut changed = request.clone();
    changed.model = model("provider-b");
    assert!(matches!(
        request.check_replay(&changed),
        Err(FinancialError::ReplayConflict {
            phase: ReplayPhase::Begin,
            ..
        })
    ));
    changed = request.clone();
    changed.token_budget = TrustedTokenUsage::from_disjoint(11, 20, 0, 0, 0);
    assert!(request.check_replay(&changed).is_err());

    let evidence = finalize(request.invocation_id);
    assert!(evidence.check_replay(&evidence.clone()).is_ok());
    let mut changed = evidence.clone();
    changed.usage = UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(2, 2, 0, 0, 0));
    assert!(matches!(
        evidence.check_replay(&changed),
        Err(FinancialError::ReplayConflict {
            phase: ReplayPhase::Finalize,
            ..
        })
    ));
    changed = evidence.clone();
    changed.provider_request_id = None;
    assert!(evidence.check_replay(&changed).is_err());
    changed = evidence.clone();
    changed.occurred_at += chrono::Duration::seconds(1);
    assert!(evidence.check_replay(&changed).is_err());
}

#[test]
fn missing_usage_is_not_reported_zero() {
    let zero = UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0));
    let missing = UsageEvidence::Missing(UnresolvedReason::UsageNotReported);
    assert_ne!(zero, missing);
    let mut evidence = finalize(InvocationId::new());
    evidence.usage = zero;
    let mut replay = evidence.clone();
    replay.usage = missing;
    assert!(evidence.check_replay(&replay).is_err());
    assert_eq!(
        rate("provider-a")
            .tokens
            .price(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0))
            .unwrap(),
        PublicUsage::from_units(0)
    );
}

// Implementing the ports through boxed futures is a compile-time object-safety check.
struct UnavailableFinancial;

impl FinancialUsage for UnavailableFinancial {
    fn begin(&self, _: BeginInvocation) -> FinancialFuture<'_, Recorded<AuthorizedInvocation>> {
        Box::pin(async { Err(FinancialError::CapabilityUnavailable) })
    }

    fn finalize(&self, _: FinalizeInvocation) -> FinancialFuture<'_, Recorded<InvocationRecord>> {
        Box::pin(async { Err(FinancialError::CapabilityUnavailable) })
    }

    fn get(&self, _: InvocationId) -> FinancialFuture<'_, Option<InvocationRecord>> {
        Box::pin(async { Err(FinancialError::CapabilityUnavailable) })
    }

    fn pending(&self, _: PendingInvocations) -> FinancialFuture<'_, Vec<InvocationRecord>> {
        Box::pin(async { Err(FinancialError::CapabilityUnavailable) })
    }
}

#[tokio::test]
async fn separate_object_safe_capability_fails_closed_for_activated_traffic() {
    let _analytics: Arc<dyn UsageRecorder> = Arc::new(NoOpUsageRecorder);
    let missing = FinancialCapability::Unavailable;
    assert!(matches!(
        missing.for_mode(FinancialMode::Activated),
        Err(FinancialError::CapabilityUnavailable)
    ));
    assert!(missing.for_mode(FinancialMode::Legacy).unwrap().is_none());
    assert!(
        missing
            .for_mode(FinancialMode::NonFinancial(ExclusionReason::ExemptFeature))
            .unwrap()
            .is_none()
    );
    let financial: Arc<dyn FinancialUsage> = Arc::new(UnavailableFinancial);
    let capability = FinancialCapability::Available(financial);
    assert!(matches!(
        capability
            .for_mode(FinancialMode::Activated)
            .unwrap()
            .unwrap()
            .begin(begin())
            .await,
        Err(FinancialError::CapabilityUnavailable)
    ));
    fn assert_dyn_ports(
        _: &dyn crate::domain::ports::FinancialRateResolver,
        _: &dyn crate::domain::ports::InvocationFunding,
    ) {
    }
    let _ = assert_dyn_ports;
}
