use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::{Body, Bytes};
use axum::http::header::{AUTHORIZATION, COOKIE};
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use macro_auth::middleware::decode_jwt::{JwtValidationArgs, MacroAccessToken};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState,
};
use macro_env::Environment;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::{health, mount_at_root_and_prefix, *};

const ACCESS_TOKEN_COOKIE: &str = "macro-access-token";
const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";
const TEST_INTERNAL_API_KEY: &str = "test-internal-key";
const TEST_USER_ID: &str = "macro|image-proxy-test@example.com";

fn test_context() -> ApiContext {
    let authorization_service = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
        InternalAuthConfig {
            api_key: TEST_INTERNAL_API_KEY.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        macro_authorization::NoUserApiKeyAuthorizer,
    );

    ApiContext {
        authorization_state: MacroAuthorizationState::new(Arc::new(authorization_service)),
        environment: Environment::Production,
        http_client: proxy::build_http_client().expect("test HTTP client should build"),
    }
}

fn access_token(expiration: usize) -> String {
    let claims = MacroAccessToken {
        aud: String::new(),
        exp: expiration,
        tid: "test-tenant".to_string(),
        iss: String::new(),
        email: "image-proxy-test@example.com".to_string(),
        fusion_user_id: "test-fusion-user".to_string(),
        macro_user_id: TEST_USER_ID.to_string(),
        macro_organization_id: None,
        root_macro_id: None,
    };
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("test-access-token".to_string());

    jsonwebtoken::encode(&header, &claims, &EncodingKey::from_secret(b""))
        .expect("test access token should encode")
}

fn valid_expiration() -> usize {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after the Unix epoch")
        .as_secs() as usize
        + 3_600
}

fn proxy_request(uri: &str) -> axum::http::request::Builder {
    Request::get(uri).header("x-forwarded-for", "203.0.113.1")
}

async fn send(request: Request<Body>) -> (StatusCode, Bytes) {
    let response = app(test_context())
        .oneshot(request)
        .await
        .expect("application should return a response");
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("response body should collect")
        .to_bytes();

    (status, body)
}

fn assert_json_response(
    response: (StatusCode, Bytes),
    expected_status: StatusCode,
    expected_body: Value,
) {
    assert_eq!(response.0, expected_status);
    assert_eq!(
        serde_json::from_slice::<Value>(&response.1).expect("response should contain JSON"),
        expected_body
    );
}

#[tokio::test]
async fn proxy_rejects_missing_credentials() {
    let request = proxy_request("/proxy?url=http://127.0.0.1/image.png")
        .body(Body::empty())
        .unwrap();

    assert_json_response(
        send(request).await,
        StatusCode::UNAUTHORIZED,
        json!({ "message": "unauthorized" }),
    );
}

#[tokio::test]
async fn authentication_precedes_proxy_query_validation() {
    for uri in ["/proxy", "/proxy?url=not-a-url"] {
        let request = proxy_request(uri).body(Body::empty()).unwrap();

        assert_json_response(
            send(request).await,
            StatusCode::UNAUTHORIZED,
            json!({ "message": "unauthorized" }),
        );
    }
}

#[tokio::test]
async fn proxy_rejects_malformed_bearer_credentials() {
    let request = proxy_request("/proxy?url=http://127.0.0.1/image.png")
        .header(AUTHORIZATION, "Bearer not-a-token")
        .body(Body::empty())
        .unwrap();

    assert_json_response(
        send(request).await,
        StatusCode::UNAUTHORIZED,
        json!({ "message": "unauthorized" }),
    );
}

#[tokio::test]
async fn proxy_rejects_expired_credentials() {
    let token = access_token(1);
    let request = proxy_request("/proxy?url=http://127.0.0.1/image.png")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    assert_json_response(
        send(request).await,
        StatusCode::UNAUTHORIZED,
        json!({ "message": "jwt expired" }),
    );
}

#[tokio::test]
async fn valid_cookie_credentials_reach_loopback_ssrf_rejection() {
    let token = access_token(valid_expiration());
    let request = proxy_request("/proxy?url=http://127.0.0.1/image.png")
        .header(COOKIE, format!("{ACCESS_TOKEN_COOKIE}={token}"))
        .body(Body::empty())
        .unwrap();
    let (status, body) = send(request).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body,
        "requests to private/internal IPs are not allowed".as_bytes()
    );
}

#[tokio::test]
async fn proxy_rejects_internal_credentials_without_an_acting_user() {
    let request = proxy_request("/proxy?url=http://127.0.0.1/image.png")
        .header(INTERNAL_API_KEY_HEADER, TEST_INTERNAL_API_KEY)
        .body(Body::empty())
        .unwrap();

    assert_json_response(
        send(request).await,
        StatusCode::UNAUTHORIZED,
        json!({ "message": "unauthorized" }),
    );
}

#[tokio::test]
async fn health_remains_public() {
    for path in ["/health", "/image-proxy/health"] {
        let request = Request::get(path).body(Body::empty()).unwrap();
        let (status, _) = send(request).await;

        assert_eq!(status, StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/image-proxy/health"] {
        let response = mount_at_root_and_prefix(health::router())
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    let response = mount_at_root_and_prefix(health::router())
        .oneshot(
            Request::builder()
                .uri("/missing")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn prefixed_proxy_reaches_existing_auth() {
    let request = proxy_request("/image-proxy/proxy?url=http://127.0.0.1/image.png")
        .body(Body::empty())
        .unwrap();

    assert_json_response(
        send(request).await,
        StatusCode::UNAUTHORIZED,
        json!({ "message": "unauthorized" }),
    );
}
