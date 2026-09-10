use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::FromRef,
    http::{Method, Request, StatusCode},
    routing::{get, post},
};
use http_body_util::BodyExt;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
#[allow(deprecated)]
use macro_authorization::LEGACY_DSS_INTERNAL_API_KEY_HEADER;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, InternalAuthConfig, InternalOnly, MacroAuthJwtValidator,
    MacroAuthorizationExtractor, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;

use super::{connection, entities, message};
use crate::{
    config::Config,
    context::{ApiContext, AppState, AuthorizationService},
};

const TEST_INTERNAL_API_KEY: &str = "connection-gateway-test-internal-key";
const WRONG_INTERNAL_API_KEY: &str = "wrong-internal-key";
const WEBSOCKET_PATH: &str = "/";
const UNAUTHORIZED_BODY: &str = r#"{"message":"unauthorized"}"#;

#[derive(Clone)]
struct TestState {
    authorization_state: MacroAuthorizationState<AuthorizationService>,
}

impl FromRef<TestState> for MacroAuthorizationState<AuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization_state.clone()
    }
}

impl FromRef<TestState> for AppState {
    fn from_ref(_state: &TestState) -> Self {
        panic!("authorization must reject before AppState extraction")
    }
}

impl FromRef<TestState> for ApiContext {
    fn from_ref(_state: &TestState) -> Self {
        panic!("authorization must reject before ApiContext extraction")
    }
}

impl FromRef<TestState> for Arc<Config> {
    fn from_ref(_state: &TestState) -> Self {
        panic!("authorization must reject before websocket configuration extraction")
    }
}

async fn internal_auth_probe(
    _authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
) -> Json<Value> {
    Json(json!({ "authorized": true }))
}

fn test_state() -> TestState {
    let authorization_service = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
        InternalAuthConfig {
            api_key: TEST_INTERNAL_API_KEY.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        macro_authorization::NoUserApiKeyAuthorizer,
    );

    TestState {
        authorization_state: MacroAuthorizationState::new(Arc::new(authorization_service)),
    }
}

fn test_router() -> Router {
    Router::new()
        .route(
            "/message/send/{entity_type}/{entity_id}",
            post(message::send_message_handler),
        )
        .route(
            "/message/batch_send",
            post(message::batch_send_message_handler),
        )
        .route(
            "/message/batch_send_unique",
            post(message::batch_send_unique_messages_handler),
        )
        .route(
            "/track/{entity_type}/{entity_id}",
            get(entities::get_entity_handler),
        )
        .route(WEBSOCKET_PATH, get(connection::ws_handler))
        .route("/internal-auth-probe", get(internal_auth_probe))
        .with_state(test_state())
}

async fn send(request: Request<Body>) -> (StatusCode, Value) {
    let response = test_router()
        .oneshot(request)
        .await
        .expect("test router should return a response");
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("response body should collect")
        .to_bytes();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");

    (status, body)
}

fn assert_unauthorized((status, body): (StatusCode, Value)) {
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
}

#[tokio::test]
async fn internal_routes_reject_missing_and_incorrect_keys_before_other_extraction() {
    let endpoints = [
        (Method::POST, "/message/send/user/macro%7Ctest@example.com"),
        (Method::POST, "/message/batch_send"),
        (Method::POST, "/message/batch_send_unique"),
        (Method::GET, "/track/user/macro%7Ctest@example.com"),
    ];

    for (method, uri) in endpoints {
        for key in [None, Some(WRONG_INTERNAL_API_KEY)] {
            let mut request = Request::builder().method(method.clone()).uri(uri);
            if let Some(key) = key {
                request = request.header(INTERNAL_API_KEY_HEADER, key);
            }

            let request = request
                .body(Body::empty())
                .expect("test request should build");
            assert_unauthorized(send(request).await);
        }
    }
}

#[tokio::test]
async fn websocket_rejects_invalid_credentials_before_infrastructure_state() {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("test listener should bind");
    let address = listener
        .local_addr()
        .expect("test listener should have a local address");
    let server = tokio::spawn(async move {
        axum::serve(listener, test_router().into_make_service())
            .await
            .expect("test server should run");
    });

    for headers in [
        Vec::new(),
        vec![("authorization", "Bearer not-a-token")],
        vec![(INTERNAL_API_KEY_HEADER, TEST_INTERNAL_API_KEY)],
    ] {
        let (status, body) = send_websocket_request(address, WEBSOCKET_PATH, &headers).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, UNAUTHORIZED_BODY);
    }

    server.abort();
}

async fn send_websocket_request(
    address: std::net::SocketAddr,
    path: &str,
    headers: &[(&str, &str)],
) -> (StatusCode, String) {
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("test client should connect");
    let mut request = format!(
        "GET {path} HTTP/1.1\r\n\
         Host: {address}\r\n\
         Connection: Upgrade\r\n\
         Upgrade: websocket\r\n\
         Sec-WebSocket-Version: 13\r\n\
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
    );
    for (name, value) in headers {
        request.push_str(name);
        request.push_str(": ");
        request.push_str(value);
        request.push_str("\r\n");
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .await
        .expect("websocket request should write");

    let response = read_http_response(&mut stream).await;
    parse_http_response(&response)
}

async fn read_http_response(stream: &mut tokio::net::TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    let mut buffer = [0; 1024];

    loop {
        let bytes_read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer))
            .await
            .expect("test server should respond before timeout")
            .expect("test response should read");
        assert_ne!(
            bytes_read, 0,
            "test server closed before sending a full response"
        );
        response.extend_from_slice(&buffer[..bytes_read]);

        if response_is_complete(&response) {
            return response;
        }
    }
}

fn response_is_complete(response: &[u8]) -> bool {
    let Some(header_end) = find_bytes(response, b"\r\n\r\n") else {
        return false;
    };
    let header_end = header_end + 4;
    let headers = std::str::from_utf8(&response[..header_end])
        .expect("test response headers should be UTF-8");
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length").then(|| {
                value
                    .trim()
                    .parse::<usize>()
                    .expect("content length should parse")
            })
        })
        .expect("test response should have a content length");

    response.len() >= header_end + content_length
}

fn parse_http_response(response: &[u8]) -> (StatusCode, String) {
    let header_end =
        find_bytes(response, b"\r\n\r\n").expect("response should contain headers") + 4;
    let headers = std::str::from_utf8(&response[..header_end])
        .expect("test response headers should be UTF-8");
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .and_then(|status| StatusCode::from_u16(status).ok())
        .expect("test response should contain a valid status");
    let body = std::str::from_utf8(&response[header_end..])
        .expect("test response body should be UTF-8")
        .to_string();

    (status, body)
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[allow(deprecated)]
#[tokio::test]
async fn internal_probe_accepts_both_header_conventions_and_rejects_wrong_keys() {
    for header in [INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_API_KEY_HEADER] {
        let valid_request = Request::get("/internal-auth-probe")
            .header(header, TEST_INTERNAL_API_KEY)
            .body(Body::empty())
            .expect("valid probe request should build");
        let (status, body) = send(valid_request).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "authorized": true }));

        let invalid_request = Request::get("/internal-auth-probe")
            .header(header, WRONG_INTERNAL_API_KEY)
            .body(Body::empty())
            .expect("invalid probe request should build");
        assert_unauthorized(send(invalid_request).await);
    }
}

#[tokio::test]
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/connection-gateway/health"] {
        let response = super::mount_at_root_and_prefix(super::health::router())
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
    let response = super::mount_at_root_and_prefix(super::health::router())
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
async fn websocket_upgrade_is_authorized_at_root_and_gateway_prefix() {
    for path in [
        WEBSOCKET_PATH,
        "/connection-gateway",
        "/connection-gateway/",
        "/connection-gateway?macro-api-token=not-a-token",
    ] {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("test listener should bind");
        let address = listener
            .local_addr()
            .expect("test listener should have a local address");
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                super::mount_at_root_and_prefix(test_router())
                    .merge(
                        Router::new()
                            .route("/connection-gateway/", get(connection::ws_handler))
                            .with_state(test_state()),
                    )
                    .into_make_service(),
            )
            .await
            .expect("test server should run");
        });

        let (status, body) =
            send_websocket_request(address, path, &[("authorization", "Bearer not-a-token")]).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(body, UNAUTHORIZED_BODY, "{path}");

        server.abort();
    }
}

#[tokio::test]
async fn openapi_document_is_served_at_root_and_gateway_prefix() {
    for path in [
        "/api-doc/openapi.json",
        "/connection-gateway/api-doc/openapi.json",
    ] {
        let response = super::swagger_ui()
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
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let spec: Value = serde_json::from_slice(&body)
            .unwrap_or_else(|_| panic!("{path} should be OpenAPI JSON"));
        assert!(
            spec.get("openapi").is_some(),
            "{path} should contain an openapi version"
        );
    }
}
