use super::activity::{DatabaseChange, ToolOutcome};
use super::*;
use crate::api::context::test::{
    ADMISSION_TEST_USER, TestAdmission, admission_errors, authorized_request, test_api_context,
};
use axum::{Router, routing::post};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use tower::ServiceExt;

#[test]
fn completion_failure_after_committed_changes_is_interrupted() {
    let response = partial_completion_or_error(
        vec![StructuredToolActivity {
            name: "AddColumn".into(),
            outcome: ToolOutcome::Succeeded {
                changes: DatabaseChange::Schema,
            },
        }],
        StructuredCompletionError {
            error: "provider interrupted".into(),
            status: StatusCode::BAD_GATEWAY,
            code: None,
        },
    )
    .unwrap()
    .0;
    assert_eq!(
        serde_json::to_value(&response).unwrap(),
        json!({
            "outcome": {"status": "interrupted", "reason": "provider interrupted"},
            "toolActivity": [
                {
                    "name": "AddColumn",
                    "outcome": {"status": "succeeded", "changes": {"kind": "schema"}},
                },
            ],
        })
    );
}

#[test]
fn completion_failure_without_changes_preserves_error_status() {
    let error = partial_completion_or_error(
        vec![StructuredToolActivity {
            name: "QueryDatabase".into(),
            outcome: ToolOutcome::Succeeded {
                changes: DatabaseChange::None,
            },
        }],
        StructuredCompletionError {
            error: "provider interrupted".into(),
            status: StatusCode::BAD_GATEWAY,
            code: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.status, StatusCode::BAD_GATEWAY);
    assert_eq!(error.error, "provider interrupted");
}

#[test]
fn completed_answers_carry_the_caller_schema_result() {
    let response = StructuredCompletionResponse {
        outcome: StructuredCompletionOutcome::Completed {
            result: json!({"answerable": true, "sql": "SELECT * FROM \"Guests\""}),
        },
        tool_activity: vec![StructuredToolActivity {
            name: "QueryDatabase".into(),
            outcome: ToolOutcome::Succeeded {
                changes: DatabaseChange::Rows { count: 2 },
            },
        }],
    };
    assert_eq!(
        serde_json::to_value(&response).unwrap(),
        json!({
            "outcome": {
                "status": "completed",
                "result": {"answerable": true, "sql": "SELECT * FROM \"Guests\""},
            },
            "toolActivity": [
                {
                    "name": "QueryDatabase",
                    "outcome": {"status": "succeeded", "changes": {"kind": "rows", "count": 2}},
                },
            ],
        })
    );
}

fn request_body() -> serde_json::Value {
    serde_json::json!({
        "prompt": "hello",
        "model": chat::domain::models::FREE_MODEL,
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
