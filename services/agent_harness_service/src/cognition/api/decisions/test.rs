use super::*;
use crate::cognition::api::context::test::{
    ADMISSION_TEST_USER, TestAdmission, admission_errors, authorized_request, test_api_context,
};
use axum::Router;
use jev::domain::{
    Probability, YesNoClassifier, YesNoQuestion,
    decisions::{DecisionService, DecisionServiceImpl},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

fn request_body() -> Value {
    json!({"input": {"subject": "Invoice"}, "questions": {"billing": "Is this about billing?"}})
}

#[derive(Default)]
struct Decisions(Mutex<Vec<(String, Value)>>);

#[async_trait::async_trait]
impl DecisionService for Decisions {
    async fn decide(
        &self,
        owner: MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, DecisionError> {
        self.0
            .lock()
            .unwrap()
            .push((owner.to_string(), serde_json::to_value(request).unwrap()));
        Ok(DecisionResponse {
            probabilities: [("billing".into(), 0.9)].into(),
        })
    }
}

struct NoProvider;

impl YesNoClassifier for NoProvider {
    async fn classify(
        &self,
        _: ai_usage::UsageContext,
        _: &Value,
        _: &[YesNoQuestion],
    ) -> Result<Vec<Probability>, JevError> {
        panic!("rejected requests must not call a provider")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn authenticated_route_preserves_the_exact_owner_and_named_contract(pool: sqlx::PgPool) {
    let mut state = (*test_api_context(pool).await).clone();
    let decisions = Arc::new(Decisions::default());
    state.decisions = decisions.clone();
    let router = Router::new().route("/decisions", route()).with_state(state);
    let response = router
        .clone()
        .oneshot(authorized_request("/decisions", request_body()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap(),
        json!({"probabilities": {"billing": 0.9}})
    );
    assert_eq!(
        *decisions.0.lock().unwrap(),
        [(ADMISSION_TEST_USER.to_owned(), request_body())]
    );

    for invalid in [
        json!({"input": null, "questions": {"q": "Valid?"}, "owner": "macro|other@example.com"}),
        json!({"input": null, "questions": []}),
    ] {
        let response = router
            .clone()
            .oneshot(authorized_request("/decisions", invalid))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let response = router
        .oneshot(authorized_request(
            "/decisions",
            json!({
                "input": "x".repeat(MAX_DECISION_REQUEST_BYTES * 2), "questions": {"q": "Valid?"}
            }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(decisions.0.lock().unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unauthorized_and_missing_user_requests_never_reach_the_domain(pool: sqlx::PgPool) {
    let mut state = (*test_api_context(pool).await).clone();
    let decisions = Arc::new(Decisions::default());
    state.decisions = decisions.clone();
    let router = Router::new().route("/decisions", route()).with_state(state);
    let mut unauthorized = authorized_request("/decisions", request_body());
    unauthorized
        .headers_mut()
        .insert("x-internal-auth-key", "invalid".parse().unwrap());
    assert_eq!(
        router.clone().oneshot(unauthorized).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let mut missing_user = authorized_request("/decisions", request_body());
    missing_user
        .headers_mut()
        .remove("x-internal-macro-user-id");
    assert!(
        !router
            .oneshot(missing_user)
            .await
            .unwrap()
            .status()
            .is_success()
    );
    assert!(decisions.0.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_errors_use_the_shared_status_and_machine_code(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool).await;
    for error in admission_errors() {
        let admission = TestAdmission::rejecting(error);
        let mut state = (*ctx).clone();
        state.decisions = Arc::new(DecisionServiceImpl::new(
            Some(NoProvider),
            admission.clone(),
        ));
        let router = Router::new().route("/decisions", route()).with_state(state);
        let response = router
            .oneshot(authorized_request("/decisions", request_body()))
            .await
            .unwrap();
        assert_eq!(response.status(), admission_status(error));
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!({"error": error.to_string(), "code": error.code()})
        );
        assert_eq!(
            *admission.calls.lock().unwrap(),
            [(
                ADMISSION_TEST_USER.into(),
                ai_usage::AiFeature::DynamicCompletionsApi
            )]
        );
    }
}

#[test]
fn openapi_includes_the_shared_request_response_and_failure_contract() {
    use utoipa::OpenApi;
    let doc = serde_json::to_value(crate::cognition::api::swagger::ApiDoc::openapi()).unwrap();
    let operation = &doc["paths"]["/decisions"]["post"];
    assert_eq!(
        operation["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/DecisionRequest"
    );
    assert_eq!(
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/DecisionResponse"
    );
    for status in ["400", "402", "500", "502", "503", "504"] {
        assert_eq!(
            operation["responses"][status]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/DecisionErrorBody"
        );
    }
}
