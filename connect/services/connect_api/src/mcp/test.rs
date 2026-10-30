use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use connect_registry::ClientRegistration;
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tower::ServiceExt as _;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_bytes, body_string_contains, header as header_matcher, method, path},
};

use crate::{
    oauth_test::{callback, fixture, start, vendor_server},
    outbound::MIGRATOR,
};

#[tokio::test]
async fn sse_first_event_arrives_before_vendor_finishes() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (release, wait_for_release) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 1024];
        socket.read_exact(&mut request[..1]).await.unwrap();
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
        let first = "data: first\n\n";
        socket
            .write_all(format!("{:x}\r\n{first}\r\n", first.len()).as_bytes())
            .await
            .unwrap();
        wait_for_release.await.unwrap();
        let second = "data: second\n\n";
        socket
            .write_all(format!("{:x}\r\n{second}\r\n0\r\n\r\n", second.len()).as_bytes())
            .await
            .unwrap();
    });
    let started = std::time::Instant::now();
    let vendor = reqwest::Client::new()
        .get(format!("http://{address}/mcp"))
        .send()
        .await
        .unwrap();
    let response = super::stream_response(vendor, tracing::Span::none(), started, "testapp");
    let mut body = response.into_body();
    let first = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .into_data()
        .unwrap();
    assert_eq!(first, "data: first\n\n");
    release.send(()).unwrap();
    assert_eq!(body.collect().await.unwrap().to_bytes(), "data: second\n\n");
    server.await.unwrap();
}

async fn connected(pool: sqlx::PgPool, vendor: &MockServer) -> (axum::Router, String, String) {
    let (app, repository, _) = fixture(
        pool,
        vendor,
        ClientRegistration::OwnApp,
        "https://connect.example",
    );
    let key = repository
        .create_customer_with_origins("customer", &["https://customer.example".into()])
        .await
        .unwrap();
    let (_, state) = start(&app, &key, "https://customer.example/done").await;
    callback(&app, &state, "").await;
    let other_key = repository.create_customer("other customer").await.unwrap();
    (app, key.as_str().to_owned(), other_key.as_str().to_owned())
}

fn request(method: Method, key: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri("/v1/users/user-a/mcp/testapp")
        .header(header::AUTHORIZATION, format!("Bearer {key}"))
        .header(header::ACCEPT, "application/json, text/event-stream")
        .header(header::CONTENT_TYPE, "application/json")
        .header("mcp-protocol-version", "2025-06-18")
        .header("mcp-session-id", "client-session")
        .body(body)
        .unwrap()
}

async fn json_response(response: axum::response::Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn forwards_json_headers_and_isolates_customers(pool: sqlx::PgPool) {
    let vendor = vendor_server(ClientRegistration::OwnApp, 3600, false, 0).await;
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer first-token"))
        .and(header_matcher("mcp-session-id", "client-session"))
        .and(header_matcher("mcp-protocol-version", "2025-06-18"))
        .and(body_string_contains("tools/list"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("mcp-session-id", "vendor-session")
                .set_body_json(json!({"jsonrpc":"2.0","id":1,"result":{"tools":[]}})),
        )
        .expect(1)
        .mount(&vendor)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/mcp"))
        .respond_with(ResponseTemplate::new(202))
        .expect(1)
        .mount(&vendor)
        .await;
    let (app, key, other_key) = connected(pool, &vendor).await;
    let response = app
        .clone()
        .oneshot(request(
            Method::POST,
            &key,
            Body::from(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}).to_string()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["mcp-session-id"], "vendor-session");
    assert_eq!(json_response(response).await["result"]["tools"], json!([]));
    let response = app
        .clone()
        .oneshot(request(Method::DELETE, &key, Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let response = app
        .clone()
        .oneshot(request(Method::GET, &other_key, Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(json_response(response).await["app_id"], "testapp");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/v1/users/user-a/mcp/unknown")
                .header(header::AUTHORIZATION, format!("Bearer {key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(json_response(response).await["app_id"], "unknown");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn streams_sse_and_preserves_content_type(pool: sqlx::PgPool) {
    let vendor = vendor_server(ClientRegistration::OwnApp, 3600, false, 0).await;
    Mock::given(method("GET"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer first-token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw("event: message\ndata: hello\n\n", "text/event-stream"),
        )
        .with_priority(1)
        .expect(1)
        .mount(&vendor)
        .await;
    let (app, key, _) = connected(pool, &vendor).await;
    let response = app
        .oneshot(request(Method::GET, &key, Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "event: message\ndata: hello\n\n"
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn unauthorized_refreshes_and_retries_once(pool: sqlx::PgPool) {
    let vendor = vendor_server(ClientRegistration::OwnApp, 3600, false, 1).await;
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer first-token"))
        .respond_with(ResponseTemplate::new(401))
        .expect(1)
        .mount(&vendor)
        .await;
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer refreshed-token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"result":{"tools":[{"name":"read"}]}})),
        )
        .expect(1)
        .mount(&vendor)
        .await;
    let (app, key, _) = connected(pool, &vendor).await;
    let response = app
        .oneshot(request(
            Method::POST,
            &key,
            Body::from(json!({"method":"tools/list"}).to_string()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_response(response).await["result"]["tools"][0]["name"],
        "read"
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn second_unauthorized_marks_connection_needs_reauth(pool: sqlx::PgPool) {
    let vendor = vendor_server(ClientRegistration::OwnApp, 3600, false, 1).await;
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .respond_with(ResponseTemplate::new(401))
        .expect(2)
        .mount(&vendor)
        .await;
    let (app, key, _) = connected(pool, &vendor).await;
    let response = app
        .clone()
        .oneshot(request(
            Method::POST,
            &key,
            Body::from(json!({"method":"tools/list"}).to_string()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_response(response).await,
        json!({"error":"needs_reauth","app_id":"testapp"})
    );
    let response = app
        .oneshot(request(Method::GET, &key, Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(json_response(response).await["error"], "needs_reauth");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn large_post_is_forwarded_without_retry(pool: sqlx::PgPool) {
    let vendor = vendor_server(ClientRegistration::OwnApp, 3600, false, 0).await;
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer first-token"))
        .and(body_bytes(vec![b'x'; super::RETRY_BODY_LIMIT + 1]))
        .respond_with(ResponseTemplate::new(401))
        .expect(1)
        .mount(&vendor)
        .await;
    let (app, key, _) = connected(pool, &vendor).await;
    let response = app
        .oneshot(request(
            Method::POST,
            &key,
            Body::from(vec![b'x'; super::RETRY_BODY_LIMIT + 1]),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
