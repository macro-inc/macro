use super::*;
use crate::{SYSTEM_USER_ID, UsageTrackingService};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::Arc;

fn request() -> TrackedInvocation {
    TrackedInvocation {
        run_id: RunId::new(),
        invocation_id: InvocationId::new(),
        user: SYSTEM_USER_ID.clone(),
        feature: AiFeature::ChatRename,
        entity: None,
        model: ProviderModel::new("anthropic", "unreviewed-model").unwrap(),
        occurred_at: Utc::now(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn observations_are_idempotent_and_never_enter_financial_accounting(pool: PgPool) {
    let service = UsageTrackingService::new(Arc::new(PgTrackingRepo::new(pool.clone())));
    let request = request();
    assert_eq!(
        service.begin(request.clone()).await.unwrap(),
        WriteDisposition::Inserted
    );
    assert_eq!(
        service.begin(request.clone()).await.unwrap(),
        WriteDisposition::Replayed
    );
    let mut changed = request.clone();
    changed.feature = AiFeature::Chat;
    assert!(matches!(
        service.begin(changed).await,
        Err(FinancialError::ReplayConflict { .. })
    ));
    let evidence = FinalizeInvocation {
        invocation_id: request.invocation_id,
        occurred_at: Utc::now(),
        provider_request_id: Some(ProviderRequestId::new("response-1").unwrap()),
        outcome: ProviderOutcome::Failed,
        usage: UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 2, 3, 4, 0)),
    };
    let (first, second) = tokio::join!(
        service.finalize(evidence.clone()),
        service.finalize(evidence.clone()),
    );
    let dispositions = [first.unwrap(), second.unwrap()];
    assert!(dispositions.contains(&WriteDisposition::Inserted));
    assert!(dispositions.contains(&WriteDisposition::Replayed));
    assert_eq!(
        service.finalize(evidence.clone()).await.unwrap(),
        WriteDisposition::Replayed
    );
    let mut conflict = evidence.clone();
    conflict.outcome = ProviderOutcome::Succeeded;
    assert!(matches!(
        service.finalize(conflict).await,
        Err(FinancialError::ReplayConflict { .. })
    ));
    let row = sqlx::query!(
        r#"SELECT finalization AS "finalization: Json<StateData>" FROM ai_usage_observation WHERE invocation_id = $1"#,
        request.invocation_id.as_uuid(),
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(
        row.finalization.unwrap().0.decode().unwrap(),
        observation_state(evidence)
    );
    let count = sqlx::query_scalar!("SELECT count(*) FROM ai_financial_invocation")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, Some(0));
    let count = sqlx::query_scalar!("SELECT count(*) FROM ai_usage")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, Some(0));
}

#[test]
fn missing_usage_is_not_measured_zero_or_exempt() {
    for (usage, unresolved) in [
        (UsageEvidence::Missing(UnresolvedReason::Interrupted), true),
        (
            UsageEvidence::Missing(UnresolvedReason::UsageNotReported),
            true,
        ),
        (
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0)),
            false,
        ),
    ] {
        let state = observation_state(FinalizeInvocation {
            invocation_id: InvocationId::new(),
            occurred_at: Utc::now(),
            provider_request_id: None,
            outcome: ProviderOutcome::Unknown,
            usage,
        });
        if unresolved {
            assert!(matches!(state, InvocationState::Unresolved { .. }));
        } else {
            assert!(matches!(
                state,
                InvocationState::Unpriced {
                    reason: UnpricedReason::MissingRate,
                    ..
                }
            ));
        }
    }
}
