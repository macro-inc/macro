use super::*;
use crate::api::stream::chat_message::test::{ACTING_USER, RejectAdmission, internal_extractors};
use ai_billing::DenyReason;
use ai_usage::AiFeature;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unavailable_billing_storage_is_503_not_a_purchase_required_response(pool: sqlx::PgPool) {
    use crate::api::stream::chat_message::test::quota::BillingFixture;
    use ai_billing::domain::PlanTier;

    let fixture = BillingFixture::personal(pool, PlanTier::Premium).await;
    fixture.record(&fixture.user, AiFeature::Chat, 16.0).await;
    fixture
        .assert_rejected(
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::AllowanceExhausted.code(),
        )
        .await;
    fixture.pool.close().await;
    fixture
        .assert_rejected(StatusCode::SERVICE_UNAVAILABLE, "ai_billing_unavailable")
        .await;
    // Exempt operations do not need a functioning billing store.
    for feature in ai_billing::domain::QUOTA_EXEMPT_FEATURES {
        fixture
            .admission
            .admit(&fixture.user, feature)
            .await
            .unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn internal_paid_actor_without_professional_permission_is_admitted_before_either_stage(
    pool: sqlx::PgPool,
) {
    let mut ctx = (*crate::api::context::test_api_context(pool.clone()).await).clone();
    let mut extractors = Vec::new();
    for _ in 0..4 {
        extractors.push(internal_extractors(&ctx).await);
    }
    pool.close().await;

    for (reason, (access, user)) in [
        Some(DenyReason::AllowanceExhausted),
        Some(DenyReason::OverageLimitReached),
        Some(DenyReason::OveragePaymentFailed),
        None,
    ]
    .into_iter()
    .zip(extractors)
    {
        let admission = RejectAdmission::new(reason);
        ctx.tool_service_context.admission = admission.clone();
        let request = serde_json::from_value(serde_json::json!({
            "prompt": "hello",
            "model": "anthropic/claude-haiku-4-5",
            "output_schema": {"name": "Answer", "schema": {"type": "object", "properties": {}}},
        }))
        .unwrap();
        let error = structured_completion(State(ctx.clone()), access, user, Json(request))
            .await
            .unwrap_err();
        let expected_status = if reason.is_some() {
            StatusCode::PAYMENT_REQUIRED
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        };
        assert_eq!(error.status, expected_status);
        assert_eq!(
            error.code.as_deref(),
            Some(reason.map(|r| r.code()).unwrap_or("ai_billing_unavailable"))
        );
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![(ACTING_USER.to_string(), AiFeature::DynamicCompletionsApi)]
        );
        let response = error.into_response();
        assert_eq!(response.status(), expected_status);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(!body["error"].as_str().unwrap().contains("not configured"));
    }
}
