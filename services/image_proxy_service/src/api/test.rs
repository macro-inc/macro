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
        logo_service: crate::domain::LogoService::new(crate::outbound::FaviconProvider(
            crate::outbound::remote_image::build_http_client().expect("test favicon client"),
        )),
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
async fn logos_require_authentication_and_reject_non_domains() {
    for path in [
        "/logos?domain=example.com",
        "/image-proxy/logos?domain=example.com",
    ] {
        let request = Request::get(path).body(Body::empty()).unwrap();
        assert_eq!(send(request).await.0, StatusCode::UNAUTHORIZED);
    }
    let token = access_token(valid_expiration());
    let request = Request::get("/logos?domain=127.0.0.1")
        .header(COOKIE, format!("{ACCESS_TOKEN_COOKIE}={token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(request).await.0, StatusCode::BAD_REQUEST);
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

#[tokio::test]
async fn generic_proxy_preserves_authenticated_error_contract_at_both_mounts() {
    let token = access_token(valid_expiration());
    for prefix in ["", "/image-proxy"] {
        for credential in [AUTHORIZATION, COOKIE] {
            for (query, status, body) in [
                (
                    "url=ftp%3A%2F%2Fexample.com%2Fimage.png",
                    StatusCode::BAD_REQUEST,
                    "only http/https URLs are allowed",
                ),
                (
                    "url=http%3A%2F%2F127.0.0.1%2Fimage.png",
                    StatusCode::FORBIDDEN,
                    "requests to private/internal IPs are not allowed",
                ),
            ] {
                let value = if credential == AUTHORIZATION {
                    format!("Bearer {token}")
                } else {
                    format!("{ACCESS_TOKEN_COOKIE}={token}")
                };
                let request = proxy_request(&format!("{prefix}/proxy?{query}"))
                    .header(credential.clone(), value)
                    .body(Body::empty())
                    .unwrap();
                let response = app(test_context()).oneshot(request).await.unwrap();
                assert_eq!(response.status(), status);
                assert_eq!(
                    response.headers()["content-type"],
                    "text/plain; charset=utf-8"
                );
                assert!(!response.headers().contains_key("cache-control"));
                assert_eq!(
                    response.into_body().collect().await.unwrap().to_bytes(),
                    body
                );
            }
        }
    }
}

#[tokio::test]
async fn generic_proxy_http_success_and_ua_retries_preserve_deployed_contract() {
    use axum::http::header::USER_AGENT;
    use axum::response::Response;

    // An explicit local HTTP proxy keeps all traffic on loopback while the
    // real generic handler still preflights the public upstream IP. The
    // production client and both DNS guards remain untouched.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (captured_tx, mut captured_rx) = tokio::sync::mpsc::unbounded_channel();
    let upstream = axum::Router::new().fallback(move |request: Request<Body>| {
        let captured_tx = captured_tx.clone();
        async move {
            let with_ua = request.headers().contains_key(USER_AGENT);
            let path = request.uri().path();
            let (status, content_type, body) = if path == "/status-retry" && with_ua {
                (
                    StatusCode::FORBIDDEN,
                    "text/plain",
                    Bytes::from_static(b"denied"),
                )
            } else if path == "/mime-retry" && with_ua {
                (
                    StatusCode::OK,
                    "text/html",
                    Bytes::from_static(b"challenge"),
                )
            } else {
                (
                    StatusCode::PARTIAL_CONTENT,
                    "image/png; charset=binary",
                    Bytes::from_static(b"\x89PNG\r\n\x1a\nimage"),
                )
            };
            captured_tx
                .send((request.uri().clone(), request.headers().clone()))
                .unwrap();
            Response::builder()
                .status(status)
                .header("content-type", content_type)
                .header("cache-control", "private, max-age=0")
                .header("set-cookie", "upstream-cookie=fixture")
                .header("x-upstream-only", "fixture")
                .body(Body::from(body))
                .unwrap()
        }
    });
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, upstream)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });
    let mut context = test_context();
    context.http_client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::http(format!("http://{address}")).unwrap())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();
    let token = access_token(valid_expiration());
    for prefix in ["", "/image-proxy"] {
        for path in ["image", "status-retry", "mime-retry"] {
            let request = proxy_request(&format!(
                "{prefix}/proxy?url=http%3A%2F%2F8.8.8.8%2F{path}%3Fsignature%3Da%252Bb"
            ))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(COOKIE, "browser-only=fixture")
            .body(Body::empty())
            .unwrap();
            let response = app(context.clone()).oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{prefix}/{path}");
            assert_eq!(
                response.headers()["content-type"],
                "image/png; charset=binary"
            );
            assert_eq!(
                response.headers()["cache-control"],
                "public, max-age=31536000, immutable"
            );
            assert_eq!(
                response.headers()["cross-origin-resource-policy"],
                "cross-origin"
            );
            assert!(!response.headers().contains_key("set-cookie"));
            assert!(!response.headers().contains_key("x-upstream-only"));
            assert_eq!(
                response.into_body().collect().await.unwrap().to_bytes(),
                &b"\x89PNG\r\n\x1a\nimage"[..]
            );
            let attempts = if path == "image" { 1 } else { 2 };
            for attempt in 0..attempts {
                let (uri, headers) = captured_rx.try_recv().unwrap();
                assert_eq!(
                    uri.to_string(),
                    format!("http://8.8.8.8/{path}?signature=a%2Bb")
                );
                assert!(!headers.contains_key(AUTHORIZATION));
                assert!(!headers.contains_key(COOKIE));
                if attempt == 0 {
                    assert_eq!(
                        headers[USER_AGENT],
                        "Mozilla/5.0 (compatible; MacroImageProxy/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    );
                } else {
                    assert!(!headers.contains_key(USER_AGENT));
                }
            }
            assert!(matches!(
                captured_rx.try_recv(),
                Err(tokio::sync::mpsc::error::TryRecvError::Empty)
            ));
        }
    }
    shutdown_tx.send(()).unwrap();
    server.await.unwrap();
}
