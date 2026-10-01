use super::*;
use crate::api::context::test::{
    ADMISSION_TEST_USER, TestAdmission, admission_errors, authorized_request, test_api_context,
};
use axum::{Router, routing::post};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use tower::ServiceExt;

fn request_body() -> serde_json::Value {
    serde_json::json!({
        "prompt": "hello",
        "model": "ignored-as-before",
        "toolset": { "type": "none" },
        "output_schema": {
            "name": "Answer",
            "schema": {
                "type": "object",
                "properties": { "answer": { "type": "string" } },
                "required": ["answer"]
            }
        }
    })
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_rejects_before_tool_discovery_and_both_provider_phases(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool).await;
    for error in admission_errors() {
        let admission = TestAdmission::rejecting(error);
        let mut state = (*ctx).clone();
        state.ai_admission = admission.clone();
        let router = Router::new()
            .route("/", post(structured_completion))
            .with_state(state);
        let response = router
            .oneshot(authorized_request("/", request_body()))
            .await
            .unwrap();
        assert_eq!(response.status(), admission_status(error));
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"error": error.to_string(), "code": error.code()})
        );
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![(
                ADMISSION_TEST_USER.into(),
                ai_usage::AiFeature::DynamicCompletionsApi
            )]
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unauthorized_request_does_not_disclose_quota(pool: sqlx::PgPool) {
    let mut state = (*test_api_context(pool).await).clone();
    let admission = TestAdmission::rejecting(ai_billing::AiAdmissionError::Unavailable);
    state.ai_admission = admission.clone();
    let router = Router::new()
        .route("/", post(structured_completion))
        .with_state(state);
    let mut request = authorized_request("/", request_body());
    request
        .headers_mut()
        .insert("x-internal-auth-key", "invalid".parse().unwrap());
    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(admission.calls.lock().unwrap().is_empty());
}

#[test]
fn openapi_documents_admission_failures_with_existing_payloads() {
    use utoipa::OpenApi;
    let doc = serde_json::to_value(crate::api::swagger::ApiDoc::openapi()).unwrap();
    for (path, schema) in [
        ("/stream/chat/message", "ChatMessageError"),
        ("/structured-completion", "StructuredCompletionError"),
    ] {
        for status in ["402", "503"] {
            assert_eq!(
                doc["paths"][path]["post"]["responses"][status]["content"]["application/json"]["schema"]
                    ["$ref"],
                format!("#/components/schemas/{schema}")
            );
        }
    }
}
