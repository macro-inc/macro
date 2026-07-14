#[cfg(feature = "local_auth")]
use std::process::Command;

use ::axum::{
    Json, Router,
    body::Body,
    extract::{FromRef, FromRequestParts},
    http::{HeaderMap, Request, StatusCode, header},
    middleware,
    routing::get,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::testing::{FakeMacroAuthorizationService, bearer, bearer_request, test_user_context};

#[cfg(feature = "local_auth")]
macro_env_var::maybe_env_var! {
    struct MacroAuthorizationLocalAuthTestChild;
}

const VALID_USER_ID: &str = "macro|valid@example.com";
const COOKIE_USER_ID: &str = "macro|cookie@example.com";
const QUERY_USER_ID: &str = "macro|query@example.com";
const BEARER_USER_ID: &str = "macro|bearer@example.com";
const OPTIONAL_USER_ID: &str = "macro|optional@example.com";
const ACCESS_TOKEN_COOKIE: &str = "macro-access-token";

fn fake_authorization_service() -> FakeMacroAuthorizationService {
    FakeMacroAuthorizationService::never(MacroAuthorizationError::InvalidCredentials)
        .with_token("valid", user_context(VALID_USER_ID, None))
        .with_token("cookie", user_context(COOKIE_USER_ID, None))
        .with_token("query", user_context(QUERY_USER_ID, None))
        .with_token("bearer", user_context(BEARER_USER_ID, None))
        .with_token("optional", user_context(OPTIONAL_USER_ID, None))
        .with_token("organization", user_context(VALID_USER_ID, Some(42)))
        .with_token("malformed-user", user_context("not-a-macro-user-id", None))
        .with_token("empty-user", user_context("", None))
        .with_token_error("expired", MacroAuthorizationError::CredentialsExpired)
}

fn user_context(user_id: &str, organization_id: Option<i32>) -> UserContext {
    let mut user_context = test_user_context(user_id);
    user_context.fusion_user_id = "fusion-user-id".to_string();
    user_context.organization_id = organization_id;
    user_context
}

#[derive(Clone)]
struct TestState {
    authorization: MacroAuthorizationServiceHandle,
    _unrelated_state: &'static str,
}

impl FromRef<TestState> for MacroAuthorizationServiceHandle {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

async fn required_handler(extractor: MacroAuthorizationExtractor) -> Json<Value> {
    Json(json!({
        "macro_user_id": extractor.macro_user_id.to_string(),
        "user_context": extractor.user_context,
    }))
}

async fn optional_handler(extractor: OptionalMacroAuthorizationExtractor) -> Json<Value> {
    Json(json!({
        "macro_user_id": extractor.macro_user_id.map(|id| id.to_string()),
        "user_context": extractor.user_context,
    }))
}

fn test_router() -> (Router, FakeMacroAuthorizationService) {
    let service = fake_authorization_service();
    let state = test_state(service.clone());
    let router = Router::new()
        .route("/required", get(required_handler))
        .route("/optional", get(optional_handler))
        .with_state(state);

    (router, service)
}

fn test_state(authorization: FakeMacroAuthorizationService) -> TestState {
    TestState {
        authorization: MacroAuthorizationServiceHandle::new(authorization),
        _unrelated_state: "composite state",
    }
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let (status, _, body) = send_with_headers(router, request).await;
    (status, body)
}

async fn send_with_headers(
    router: &Router,
    request: Request<Body>,
) -> (StatusCode, HeaderMap, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");

    (status, headers, body)
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

    assert_clone_without_service_clone::<MacroAuthorizationExtractorFor<NotClone>>();
    assert_clone_without_service_clone::<OptionalMacroAuthorizationExtractorFor<NotClone>>();
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
async fn malformed_query_falls_back_to_other_or_absent_credentials() {
    let (router, service) = test_router();
    let malformed_query = "macro-api-token=query&macro-api-token=invalid";

    let bearer_request = empty_body(
        request(&format!("/required?{malformed_query}")).header("authorization", "Bearer bearer"),
    );
    let (status, body) = send(&router, bearer_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], BEARER_USER_ID);

    let cookie_request = empty_body(
        request(&format!("/required?{malformed_query}"))
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")),
    );
    let (status, body) = send(&router, cookie_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], COOKIE_USER_ID);

    let (status, body) = send(
        &router,
        empty_body(request(&format!("/optional?{malformed_query}"))),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["user_context"]["user_id"], "");
    assert_eq!(service.calls(), ["bearer", "cookie"]);
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
        let (status, headers, body) = send_with_headers(&router, request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": "jwt expired" }));
        assert_eq!(
            headers.get(header::WWW_AUTHENTICATE).unwrap(),
            "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
        );
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

#[test]
fn rejection_kinds_have_stable_messages() {
    for (kind, message) in [
        (
            MacroAuthorizationRejectionKind::CredentialsExpired,
            "jwt expired",
        ),
        (
            MacroAuthorizationRejectionKind::InvalidCredentials,
            "unauthorized",
        ),
        (
            MacroAuthorizationRejectionKind::MissingCredentials,
            "unauthorized",
        ),
        (
            MacroAuthorizationRejectionKind::InvalidUserId,
            "invalid user id",
        ),
    ] {
        let rejection = MacroAuthorizationRejection::new(kind);
        assert_eq!(rejection.kind(), kind);
        assert_eq!(rejection.to_string(), message);
    }
}

#[tokio::test]
async fn service_handle_erases_the_concrete_service_type() {
    let service = fake_authorization_service();
    let handle = MacroAuthorizationServiceHandle::new(service.clone());

    let context = handle.authorize("valid").await.unwrap();

    assert_eq!(context.user_id, VALID_USER_ID);
    assert_eq!(service.calls(), ["valid"]);
}

#[cfg(feature = "outbound")]
#[test]
fn service_handle_can_be_created_from_jwt_validation_args() {
    let _service = MacroAuthorizationServiceHandle::from_jwt_validation_args(
        macro_auth::middleware::decode_jwt::JwtValidationArgs::new_testing(),
    );
}

#[tokio::test]
async fn authenticated_outcome_is_cached_across_extractions() {
    let service = fake_authorization_service();
    let state = test_state(service.clone());
    let request = empty_body(bearer(request("/required"), "valid"));
    let (mut parts, _) = request.into_parts();

    MacroAuthorizationExtractor::from_request_parts(&mut parts, &state)
        .await
        .unwrap();
    OptionalMacroAuthorizationExtractor::from_request_parts(&mut parts, &state)
        .await
        .unwrap();

    assert_eq!(service.calls(), ["valid"]);
}

#[tokio::test]
async fn required_extraction_rejects_cached_anonymous_outcome() {
    let service = fake_authorization_service();
    let state = test_state(service.clone());
    let (mut parts, _) = empty_body(request("/optional")).into_parts();

    OptionalMacroAuthorizationExtractor::from_request_parts(&mut parts, &state)
        .await
        .unwrap();
    parts.headers.insert(
        header::AUTHORIZATION,
        "Bearer valid".parse().expect("valid header value"),
    );
    let rejection = MacroAuthorizationExtractor::from_request_parts(&mut parts, &state)
        .await
        .err()
        .expect("required extraction should reject cached anonymity");

    assert_eq!(
        rejection.kind(),
        MacroAuthorizationRejectionKind::MissingCredentials
    );
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn extractor_gate_propagates_the_cached_outcome() {
    let service = fake_authorization_service();
    let state = test_state(service.clone());
    let router = Router::new()
        .route("/gated", get(required_handler))
        .route_layer(middleware::from_extractor_with_state::<
            MacroAuthorizationExtractor,
            _,
        >(state.clone()))
        .with_state(state);
    let request = empty_body(request("/gated").header("authorization", "Bearer valid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], VALID_USER_ID);
    assert_eq!(service.calls(), ["valid"]);
}

#[cfg(feature = "internal-identity")]
#[tokio::test]
async fn preauthorized_context_wins_over_valid_and_invalid_bearer_credentials() {
    const RAW_MARKER_USER_ID: &str = "macro|Marker@Example.com";

    let (router, service) = test_router();
    for authorization in ["Bearer valid", "invalid authorization"] {
        let marker = PreauthorizedContext::new(user_context(RAW_MARKER_USER_ID, Some(42)));
        let request = empty_body(
            request("/required")
                .header(header::AUTHORIZATION, authorization)
                .extension(marker),
        );

        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["macro_user_id"], RAW_MARKER_USER_ID.to_lowercase());
        assert_eq!(body["user_context"]["user_id"], RAW_MARKER_USER_ID);
        assert_eq!(body["user_context"]["fusion_user_id"], "fusion-user-id");
        assert_eq!(body["user_context"]["organization_id"], 42);
    }
    assert!(service.calls().is_empty());
}

#[cfg(feature = "internal-identity")]
#[tokio::test]
async fn empty_preauthorized_context_is_cached_as_anonymous() {
    let (router, service) = test_router();

    let optional_request = empty_body(
        request("/optional")
            .header(header::AUTHORIZATION, "Bearer valid")
            .extension(PreauthorizedContext::new(UserContext::default())),
    );
    let (status, body) = send(&router, optional_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);

    let required_request = empty_body(
        request("/required")
            .header(header::AUTHORIZATION, "Bearer valid")
            .extension(PreauthorizedContext::new(UserContext::default())),
    );
    let (status, body) = send(&router, required_request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert!(service.calls().is_empty());
}

#[cfg(feature = "internal-identity")]
#[tokio::test]
async fn malformed_preauthorized_user_id_is_rejected_without_reading_credentials() {
    let (router, service) = test_router();
    let marker = PreauthorizedContext::new(user_context("not-a-macro-user-id", None));
    let request = empty_body(
        request("/required")
            .header(header::AUTHORIZATION, "Bearer valid")
            .extension(marker),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn raw_user_context_extension_is_not_an_identity_channel() {
    let (router, service) = test_router();

    let required_request =
        empty_body(request("/required").extension(user_context(VALID_USER_ID, Some(42))));
    let (status, body) = send(&router, required_request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));

    let optional_request =
        empty_body(request("/optional").extension(user_context(VALID_USER_ID, Some(42))));
    let (status, body) = send(&router, optional_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["user_context"]["user_id"], "");
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn fake_defaults_to_a_test_user_and_records_calls() {
    let service = FakeMacroAuthorizationService::default();

    let user_context = service.authorize("any-token").await.unwrap();

    assert_eq!(user_context.user_id, "macro|test@example.com");
    assert_eq!(service.calls(), ["any-token"]);
}

#[test]
fn bearer_helpers_add_and_replace_authorization_headers() {
    let request = empty_body(bearer(request("/required"), "builder-token"));
    assert_eq!(
        request.headers().get(header::AUTHORIZATION).unwrap(),
        "Bearer builder-token"
    );

    let request = bearer_request(request, "request-token");
    assert_eq!(
        request.headers().get(header::AUTHORIZATION).unwrap(),
        "Bearer request-token"
    );
}

#[cfg(feature = "local_auth")]
fn is_local_auth_test_child(case: &str) -> bool {
    MacroAuthorizationLocalAuthTestChild::new()
        .is_some_and(|child_case| child_case.as_ref() == case)
}

#[cfg(feature = "local_auth")]
fn run_local_auth_test_child(
    test_name: &str,
    case: &str,
    local_user_id: Option<&str>,
    local_fusion_user_id: Option<&str>,
    local_org_id: Option<&str>,
) {
    let mut command = Command::new(std::env::current_exe().expect("test executable should exist"));
    command
        .arg(test_name)
        .arg("--exact")
        .arg("--nocapture")
        .env_remove("APP_SECRETS_JSON")
        .env_remove("LOCAL_USER_ID")
        .env_remove("LOCAL_FUSION_USER_ID")
        .env_remove("LOCAL_ORG_ID")
        .env("MACRO_AUTHORIZATION_LOCAL_AUTH_TEST_CHILD", case);

    if let Some(local_user_id) = local_user_id {
        command.env("LOCAL_USER_ID", local_user_id);
    }
    if let Some(local_fusion_user_id) = local_fusion_user_id {
        command.env("LOCAL_FUSION_USER_ID", local_fusion_user_id);
    }
    if let Some(local_org_id) = local_org_id {
        command.env("LOCAL_ORG_ID", local_org_id);
    }

    let output = command.output().expect("local-auth child should run");
    assert!(
        output.status.success(),
        "local-auth child failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("1 passed"),
        "local-auth child did not run the requested test:\n{}",
        String::from_utf8_lossy(&output.stdout),
    );
}

#[cfg(feature = "local_auth")]
#[tokio::test]
async fn local_auth_feature_is_inactive_without_local_user_id() {
    const CASE: &str = "unset";
    if !is_local_auth_test_child(CASE) {
        run_local_auth_test_child(
            "inbound::axum::test::local_auth_feature_is_inactive_without_local_user_id",
            CASE,
            None,
            None,
            None,
        );
        return;
    }

    let (router, service) = test_router();
    let request = empty_body(bearer(request("/required"), "valid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], VALID_USER_ID);
    assert_eq!(service.calls(), ["valid"]);
}

#[cfg(feature = "local_auth")]
#[tokio::test]
async fn local_auth_wins_over_credentials_and_primes_the_request_cache() {
    const CASE: &str = "valid";
    const LOCAL_USER_ID: &str = "macro|Local@Example.com";
    if !is_local_auth_test_child(CASE) {
        run_local_auth_test_child(
            "inbound::axum::test::local_auth_wins_over_credentials_and_primes_the_request_cache",
            CASE,
            Some(LOCAL_USER_ID),
            Some("local-fusion-user"),
            Some("73"),
        );
        return;
    }

    let service = fake_authorization_service();
    let state = test_state(service.clone());
    let router = Router::new()
        .route("/gated", get(required_handler))
        .route_layer(middleware::from_extractor_with_state::<
            MacroAuthorizationExtractor,
            _,
        >(state.clone()))
        .with_state(state);
    let request = empty_body(bearer(request("/gated"), "valid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], LOCAL_USER_ID.to_lowercase());
    assert_eq!(body["user_context"]["user_id"], LOCAL_USER_ID);
    assert_eq!(body["user_context"]["fusion_user_id"], "local-fusion-user");
    assert_eq!(body["user_context"]["organization_id"], 73);
    assert!(service.calls().is_empty());
}

#[cfg(feature = "local_auth")]
#[tokio::test]
async fn local_auth_rejects_a_malformed_user_id_before_credentials() {
    const CASE: &str = "malformed-user";
    if !is_local_auth_test_child(CASE) {
        run_local_auth_test_child(
            "inbound::axum::test::local_auth_rejects_a_malformed_user_id_before_credentials",
            CASE,
            Some("not-a-macro-user-id"),
            None,
            Some("1"),
        );
        return;
    }

    let (router, service) = test_router();
    let request = empty_body(bearer(request("/required"), "valid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert!(service.calls().is_empty());
}

#[cfg(feature = "local_auth")]
#[tokio::test]
async fn local_auth_rejects_a_malformed_organization_before_credentials() {
    const CASE: &str = "malformed-organization";
    if !is_local_auth_test_child(CASE) {
        run_local_auth_test_child(
            "inbound::axum::test::local_auth_rejects_a_malformed_organization_before_credentials",
            CASE,
            Some("macro|local@example.com"),
            None,
            Some("not-an-i32"),
        );
        return;
    }

    let (router, service) = test_router();
    let request = empty_body(bearer(request("/required"), "valid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert!(service.calls().is_empty());
}
