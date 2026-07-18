use std::{
    borrow::Cow,
    sync::{Arc, Mutex},
};

use ::axum::{
    Json, Router,
    body::Body,
    extract::FromRef,
    http::{HeaderValue, Request, StatusCode},
    response::IntoResponse,
    routing::get,
};
use http_body_util::BodyExt;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::InternalIdentityClaims;

const VALID_USER_ID: &str = "macro|valid@example.com";
const COOKIE_USER_ID: &str = "macro|cookie@example.com";
const QUERY_USER_ID: &str = "macro|query@example.com";
const BEARER_USER_ID: &str = "macro|bearer@example.com";
const OPTIONAL_USER_ID: &str = "macro|optional@example.com";
const STANDARD_INTERNAL_USER_ID: &str = "macro|standard-internal@example.com";
const LEGACY_INTERNAL_USER_ID: &str = "macro|legacy-internal@example.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";
const ACCESS_TOKEN_COOKIE: &str = "macro-access-token";

#[derive(Clone, Debug, Eq, PartialEq)]
enum AuthorizationCall {
    Jwt(String),
    Internal {
        provided_key: String,
        claims: InternalIdentityClaims,
    },
}

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    calls: Arc<Mutex<Vec<AuthorizationCall>>>,
}

impl FakeAuthorizationService {
    fn calls(&self) -> Vec<AuthorizationCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Jwt(jwt.to_string()));

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

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Internal {
                provided_key: provided_key.to_string(),
                claims: claims.clone(),
            });

        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        let Some(user_id) = claims.user_id else {
            return Ok(None);
        };

        Ok(Some(UserContext {
            user_id,
            fusion_user_id: claims.fusion_user_id.unwrap_or_default(),
            permissions: None,
            organization_id: claims.organization_id,
        }))
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
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
    _unrelated_state: &'static str,
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

async fn required_handler(
    extractor: MacroAuthorizationExtractor<FakeAuthorizationService>,
) -> Json<Value> {
    let extractor = extractor.clone();

    Json(json!({
        "macro_user_id": extractor.macro_user_id.to_string(),
        "user_context": extractor.user_context,
        "is_internal_access": extractor.is_internal_access,
    }))
}

async fn optional_handler(
    extractor: OptionalMacroAuthorizationExtractor<FakeAuthorizationService>,
) -> Json<Value> {
    let extractor = extractor.clone();

    Json(json!({
        "macro_user_id": extractor.macro_user_id.map(|id| id.to_string()),
        "user_context": extractor.user_context,
        "is_internal_access": extractor.is_internal_access,
    }))
}

async fn internal_handler(
    extractor: InternalMacroAuthorizationExtractor<FakeAuthorizationService>,
) -> Json<Value> {
    let _extractor = extractor.clone();
    Json(json!({ "authorized": true }))
}

fn test_router() -> (Router, FakeAuthorizationService) {
    let service = FakeAuthorizationService::default();
    let state = TestState {
        authorization: MacroAuthorizationState::new(Arc::new(service.clone())),
        _unrelated_state: "composite state",
    };
    let router = Router::new()
        .route("/required", get(required_handler))
        .route("/optional", get(optional_handler))
        .route("/internal", get(internal_handler))
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

fn assert_display_and_error<T: std::fmt::Display + std::error::Error>() {}

#[test]
fn rejection_is_displayable_error_with_client_safe_message() {
    assert_display_and_error::<MacroAuthorizationRejection>();

    let rejection = MacroAuthorizationRejection {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: Cow::Borrowed("client-safe message"),
    };

    assert_eq!(rejection.to_string(), "client-safe message");
}

#[tokio::test]
async fn rejection_response_preserves_status_and_cow_message() {
    let cases = [
        MacroAuthorizationRejection {
            status: StatusCode::IM_A_TEAPOT,
            message: Cow::Borrowed("borrowed message"),
        },
        MacroAuthorizationRejection {
            status: StatusCode::FORBIDDEN,
            message: Cow::Owned("owned message".to_string()),
        },
    ];

    for rejection in cases {
        let expected_status = rejection.status;
        let expected_body = format!(r#"{{"message":"{}"}}"#, rejection.message);
        let response = rejection.into_response();
        let status = response.status();
        let body = response
            .into_body()
            .collect()
            .await
            .expect("rejection response body should be readable")
            .to_bytes();

        assert_eq!(status, expected_status);
        assert_eq!(body.as_ref(), expected_body.as_bytes());
    }
}

#[test]
fn state_and_extractors_are_clone_without_requiring_service_clone() {
    struct NotClone;

    assert_clone_without_service_clone::<MacroAuthorizationState<NotClone>>();
    assert_clone_without_service_clone::<InternalMacroAuthorizationExtractor<NotClone>>();
    assert_clone_without_service_clone::<MacroAuthorizationExtractor<NotClone>>();
    assert_clone_without_service_clone::<OptionalMacroAuthorizationExtractor<NotClone>>();
}

#[allow(deprecated)]
#[tokio::test]
async fn internal_accepts_standard_and_legacy_api_keys_without_identity_headers() {
    let (router, service) = test_router();

    for header in [INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_API_KEY_HEADER] {
        let request = empty_body(request("/internal").header(header, VALID_INTERNAL_KEY));
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "authorized": true }));
    }

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
        ]
    );
}

#[tokio::test]
async fn internal_forwards_identity_headers_to_create_user_context() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/internal")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "42")
            .header(INTERNAL_FUSIONAUTH_USER_ID_HEADER, "fusion-user"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "authorized": true }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                fusion_user_id: Some("fusion-user".to_string()),
                organization_id: Some(42),
            },
        }]
    );
}

#[tokio::test]
async fn internal_rejects_missing_key_and_does_not_fall_back_to_jwt() {
    let (router, service) = test_router();

    for request in [
        empty_body(request("/internal")),
        empty_body(request("/internal").header("authorization", "Bearer valid")),
    ] {
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": "unauthorized" }));
    }

    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn internal_rejects_invalid_api_key() {
    let (router, service) = test_router();
    let request = empty_body(request("/internal").header(INTERNAL_API_KEY_HEADER, "invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: "invalid".to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn internal_standard_key_takes_precedence_over_legacy_key() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/internal")
            .header(INTERNAL_API_KEY_HEADER, "invalid-standard-key")
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: "invalid-standard-key".to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn required_extracts_valid_bearer_and_preserves_organization() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer organization"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], VALID_USER_ID);
    assert_eq!(body["user_context"]["organization_id"], 42);
    assert_eq!(body["is_internal_access"], false);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("organization".to_string())]
    );
}

#[tokio::test]
async fn required_extracts_valid_cookie() {
    let (router, service) = test_router();
    let request =
        empty_body(request("/required").header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], COOKIE_USER_ID);
    assert_eq!(body["is_internal_access"], false);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("cookie".to_string())]
    );
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
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("query".to_string())]
    );
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
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("bearer".to_string())]
    );
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
    assert_eq!(body["is_internal_access"], false);
    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Jwt("bearer".to_string()),
            AuthorizationCall::Jwt("cookie".to_string()),
        ]
    );
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
    assert_eq!(body["is_internal_access"], false);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn required_rejects_invalid_credentials() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("invalid".to_string())]
    );
}

#[tokio::test]
async fn optional_rejects_supplied_invalid_credentials() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("invalid".to_string())]
    );
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

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Jwt("expired".to_string()),
            AuthorizationCall::Jwt("expired".to_string()),
        ]
    );
}

#[tokio::test]
async fn required_rejects_malformed_user_id() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer malformed-user"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("malformed-user".to_string())]
    );
}

#[tokio::test]
async fn optional_rejects_empty_user_id_from_authorized_context() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer empty-user"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("empty-user".to_string())]
    );
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
    assert_eq!(body["is_internal_access"], false);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("optional".to_string())]
    );
}

#[tokio::test]
async fn standard_internal_headers_authorize_matching_claims() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "42")
            .header(INTERNAL_FUSIONAUTH_USER_ID_HEADER, "standard-fusion-id")
            .header("authorization", "Bearer invalid"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], STANDARD_INTERNAL_USER_ID);
    assert_eq!(body["user_context"]["fusion_user_id"], "standard-fusion-id");
    assert_eq!(body["user_context"]["organization_id"], 42);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                fusion_user_id: Some("standard-fusion-id".to_string()),
                organization_id: Some(42),
            },
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn legacy_dss_headers_authorize_matching_claims() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(
                LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
                LEGACY_INTERNAL_USER_ID,
            ),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], LEGACY_INTERNAL_USER_ID);
    assert_eq!(body["user_context"]["fusion_user_id"], "");
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(LEGACY_INTERNAL_USER_ID.to_string()),
                ..InternalIdentityClaims::default()
            },
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn internal_identity_headers_are_not_mixed_between_conventions() {
    let (router, service) = test_router();

    let standard_request = empty_body(
        request("/optional")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(
                LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
                LEGACY_INTERNAL_USER_ID,
            ),
    );
    let (status, body) = send(&router, standard_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);

    let legacy_request = empty_body(
        request("/optional")
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "42")
            .header(INTERNAL_FUSIONAUTH_USER_ID_HEADER, "standard-fusion-id"),
    );
    let (status, body) = send(&router, legacy_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
        ]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn standard_convention_takes_precedence_when_both_keys_are_present() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, "invalid-legacy-key")
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(
                LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
                LEGACY_INTERNAL_USER_ID,
            ),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], STANDARD_INTERNAL_USER_ID);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                ..InternalIdentityClaims::default()
            },
        }]
    );
}

#[tokio::test]
async fn invalid_internal_key_rejects_without_jwt_fallback() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, "invalid-internal-key")
            .header("authorization", "Bearer valid"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: "invalid-internal-key".to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn malformed_internal_key_rejects_without_jwt_fallback() {
    let (router, service) = test_router();
    let malformed_key = HeaderValue::from_bytes(b"\xff").unwrap();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, malformed_key)
            .header("authorization", "Bearer valid"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn identityless_internal_request_is_rejected_by_required_extractor() {
    let (router, service) = test_router();
    let request =
        empty_body(request("/required").header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn identityless_internal_request_is_preserved_by_optional_extractor() {
    let (router, service) = test_router();
    let request =
        empty_body(request("/optional").header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["user_context"]["user_id"], "");
    assert_eq!(body["user_context"]["fusion_user_id"], "");
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["user_context"]["permissions"], Value::Null);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn malformed_internal_organization_is_ignored() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "not-an-integer"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], STANDARD_INTERNAL_USER_ID);
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                ..InternalIdentityClaims::default()
            },
        }]
    );
}
