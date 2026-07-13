use std::sync::{Arc, Mutex};

use ::axum::{
    Json, Router,
    body::Body,
    extract::FromRef,
    http::{Request, StatusCode},
    routing::get,
};
use http_body_util::BodyExt;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;

const VALID_USER_ID: &str = "macro|valid@example.com";
const COOKIE_USER_ID: &str = "macro|cookie@example.com";
const QUERY_USER_ID: &str = "macro|query@example.com";
const BEARER_USER_ID: &str = "macro|bearer@example.com";
const OPTIONAL_USER_ID: &str = "macro|optional@example.com";
const ACCESS_TOKEN_COOKIE: &str = "macro-access-token";

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    calls: Arc<Mutex<Vec<String>>>,
}

impl FakeAuthorizationService {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(jwt.to_string());

        match jwt {
            "valid" => Ok(user_context(VALID_USER_ID, None)),
            "cookie" => Ok(user_context(COOKIE_USER_ID, None)),
            "query" => Ok(user_context(QUERY_USER_ID, None)),
            "bearer" => Ok(user_context(BEARER_USER_ID, None)),
            "optional" => Ok(user_context(OPTIONAL_USER_ID, None)),
            "organization" => Ok(user_context(VALID_USER_ID, Some(42))),
            "malformed-user" => Ok(user_context("not-a-macro-user-id", None)),
            "empty-user" => Ok(user_context("", None)),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }
}

fn user_context(user_id: &str, organization_id: Option<i32>) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        permissions: None,
        organization_id,
    }
}

#[derive(Clone)]
struct TestState {
    authorization: Arc<FakeAuthorizationService>,
    _unrelated_state: &'static str,
}

impl FromRef<TestState> for Arc<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

async fn required_handler(
    extractor: MacroAuthorizationExtractor<FakeAuthorizationService>,
) -> Json<Value> {
    Json(json!({
        "macro_user_id": extractor.macro_user_id.to_string(),
        "user_context": extractor.user_context,
    }))
}

async fn optional_handler(
    extractor: OptionalMacroAuthorizationExtractor<FakeAuthorizationService>,
) -> Json<Value> {
    Json(json!({
        "macro_user_id": extractor.macro_user_id.map(|id| id.to_string()),
        "user_context": extractor.user_context,
    }))
}

fn test_router() -> (Router, FakeAuthorizationService) {
    let service = FakeAuthorizationService::default();
    let state = TestState {
        authorization: Arc::new(service.clone()),
        _unrelated_state: "composite state",
    };
    let router = Router::new()
        .route("/required", get(required_handler))
        .route("/optional", get(optional_handler))
        .with_state(state);

    (router, service)
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");

    (status, body)
}

fn request(path: &str) -> ::axum::http::request::Builder {
    Request::get(path)
}

fn empty_body(request: ::axum::http::request::Builder) -> Request<Body> {
    request.body(Body::empty()).unwrap()
}

fn assert_clone_without_service_clone<T: Clone>() {}

#[test]
fn extractors_are_clone_without_requiring_service_clone() {
    struct NotClone;

    assert_clone_without_service_clone::<MacroAuthorizationExtractor<NotClone>>();
    assert_clone_without_service_clone::<OptionalMacroAuthorizationExtractor<NotClone>>();
}

#[tokio::test]
async fn required_extracts_valid_bearer_and_preserves_organization() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer organization"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], VALID_USER_ID);
    assert_eq!(body["user_context"]["organization_id"], 42);
    assert_eq!(service.calls(), ["organization"]);
}

#[tokio::test]
async fn required_extracts_valid_cookie() {
    let (router, service) = test_router();
    let request =
        empty_body(request("/required").header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], COOKIE_USER_ID);
    assert_eq!(service.calls(), ["cookie"]);
}

#[tokio::test]
async fn query_token_takes_precedence_over_bearer_and_cookie() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required?macro-api-token=query")
            .header("authorization", "Bearer invalid")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=invalid")),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], QUERY_USER_ID);
    assert_eq!(service.calls(), ["query"]);
}

#[tokio::test]
async fn bearer_token_takes_precedence_over_cookie() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header("authorization", "Bearer bearer")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=invalid")),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], BEARER_USER_ID);
    assert_eq!(service.calls(), ["bearer"]);
}

#[tokio::test]
async fn required_rejects_missing_credentials() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(request("/required"))).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn optional_returns_default_context_for_missing_credentials() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(request("/optional"))).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["user_context"]["user_id"], "");
    assert_eq!(body["user_context"]["fusion_user_id"], "");
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["user_context"]["permissions"], Value::Null);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn required_rejects_invalid_credentials() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(service.calls(), ["invalid"]);
}

#[tokio::test]
async fn optional_rejects_supplied_invalid_credentials() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(service.calls(), ["invalid"]);
}

#[tokio::test]
async fn required_and_optional_reject_expired_credentials() {
    let (router, service) = test_router();

    for path in ["/required", "/optional"] {
        let request = empty_body(request(path).header("authorization", "Bearer expired"));
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": "jwt expired" }));
    }

    assert_eq!(service.calls(), ["expired", "expired"]);
}

#[tokio::test]
async fn required_rejects_malformed_user_id() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer malformed-user"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert_eq!(service.calls(), ["malformed-user"]);
}

#[tokio::test]
async fn optional_rejects_empty_user_id_from_authorized_context() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer empty-user"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert_eq!(service.calls(), ["empty-user"]);
}

#[tokio::test]
async fn optional_returns_authenticated_output() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer optional"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], OPTIONAL_USER_ID);
    assert_eq!(body["user_context"]["user_id"], OPTIONAL_USER_ID);
    assert_eq!(body["user_context"]["fusion_user_id"], "fusion-user-id");
    assert_eq!(service.calls(), ["optional"]);
}
