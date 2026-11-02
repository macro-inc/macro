use super::*;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt as _;
use serde_json::json;
use tower::ServiceExt as _;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path, path_regex, query_param},
};

fn state(server: &MockServer) -> AppState {
    AppState {
        client: Arc::new(ConnectClient::new(&server.uri(), "demo-test-key").unwrap()),
        http: reqwest::Client::new(),
        public_url: Url::parse("https://demo.test/demo").unwrap(),
    }
}

#[tokio::test]
async fn dashboard_renders_counts_users_filters_and_empty_state() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/v1/catalog"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"id":"notion","name":"<Notes>","description":"Notes","access":["mcp"],"mcp_url":"https://vendor.test/mcp","icon_url":"/v1/catalog/notion/icon.svg"},
            {"id":"linear","name":"Linear","description":"Tasks","access":["mcp"],"mcp_url":"https://vendor.test/mcp","icon_url":null}
        ]))).mount(&server).await;
    Mock::given(method("GET")).and(path("/v1/connections/summary"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"users":2,"connections":2,"needsReauth":1,"apps":[{"appId":"notion","active":1,"needsReauth":1}]})))
        .mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/v1/users"))
        .and(query_param("app_id", "linear"))
        .and(query_param("status", "active"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"items":[],"nextCursor":null})),
        )
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(path("/v1/users"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"items":[
            {"externalUserId":"123e4567-e89b-42d3-a456-426614174000","firstConnectedAt":"2026-10-30T09:00:00Z","connections":[
                {"externalUserId":"123e4567-e89b-42d3-a456-426614174000","appId":"linear","status":"needs_reauth","scopes":[],"createdAt":"2026-10-31T09:00:00Z","updatedAt":"2026-10-31T09:00:00Z","accessTokenExpiresAt":null},
                {"externalUserId":"123e4567-e89b-42d3-a456-426614174000","appId":"notion","status":"active","scopes":[],"createdAt":"2026-10-30T09:00:00Z","updatedAt":"2026-10-30T09:00:00Z","accessTokenExpiresAt":"2099-10-30T10:00:00Z"}
            ]},
            {"externalUserId":"<bad-user>","firstConnectedAt":"2026-10-29T09:00:00Z","connections":[
                {"externalUserId":"<bad-user>","appId":"notion","status":"needs_reauth","scopes":[],"createdAt":"2026-10-29T09:00:00Z","updatedAt":"2026-10-29T09:00:00Z","accessTokenExpiresAt":null}
            ]}
        ],"nextCursor":"next+page"}))).mount(&server).await;
    let app = router(state(&server));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/demo/dashboard")
                .header(
                    header::COOKIE,
                    "connect_demo_user=123e4567-e89b-42d3-a456-426614174000",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = body(response).await;
    assert!(html.contains("<strong>2</strong><span>Users</span>"));
    assert!(html.contains("<strong>2</strong><span>Connections</span>"));
    assert!(html.contains("<strong>1</strong><span>Needs re-auth</span>"));
    assert!(html.contains("<span class=\"badge\">you</span>"));
    assert!(html.contains("&lt;Notes&gt;"));
    assert!(html.contains("title=\"&lt;bad-user&gt;\""));
    assert!(!html.contains("title=\"<bad-user>\""));
    assert!(html.contains("/demo/icons/notion"));
    assert!(html.contains("More users"));
    assert!(html.contains("Linear: needs re-auth"));
    assert!(html.contains("cursor=next%2Bpage"));
    assert!(html.contains("data-label=\"Active\">0</td>"));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/demo/dashboard?app_id=linear&status=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let html = body(response).await;
    assert!(html.contains("No connected users match these filters."));
    assert!(html.contains("value=\"linear\" selected"));
    assert!(html.contains("value=\"active\" selected"));
}

async fn body(response: Response) -> String {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[tokio::test]
async fn catalog_escapes_vendor_text_and_tracks_cookie_identity() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/v1/catalog"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"id":"linear","name":"<Linear>","description":"<script>alert(1)</script>","access":["mcp"],"mcp_url":"https://vendor.test/mcp","icon_url":"/v1/catalog/linear/icon.svg","oauth_client":"dcr"},
            {"id":"api-app","name":"API app","description":"API access","access":["mcp","api"],"mcp_url":"https://vendor.test/mcp","icon_url":null,"oauth_client":"managed_oauth_app"}
        ]))).mount(&server).await;
    Mock::given(method("GET")).and(path("/v1/users/123e4567-e89b-42d3-a456-426614174000/connections"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([{"appId":"linear","status":"active","scopes":[],"createdAt":"2026-10-30T09:00:00Z"}])))
        .with_priority(1).mount(&server).await;
    Mock::given(method("GET"))
        .and(path_regex("^/v1/users/.*/connections$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;
    let app = router(state(&server));
    let response = app
        .clone()
        .oneshot(Request::builder().uri("/demo").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie.contains("Secure; HttpOnly; SameSite=Lax"));
    assert!(Uuid::parse_str(cookie.split('=').nth(1).unwrap().split(';').next().unwrap()).is_ok());
    let html = body(response).await;
    assert!(html.contains("&lt;Linear&gt;"));
    assert!(html.contains("&lt;script&gt;alert(1)&lt;&#x2F;script&gt;"));
    assert!(!html.contains("<script>alert(1)</script>"));
    assert!(html.contains("MCP + API"));
    assert!(html.contains("<span class=\"badge\">DCR</span>"));
    assert!(html.contains("<span class=\"badge\">Managed OAuth app</span>"));
    assert!(html.contains("/demo/icons/linear"));
    assert!(html.contains("id=\"workspace\""));
    assert!(html.contains("fetch(form.action"));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/demo")
                .header(
                    header::COOKIE,
                    "connect_demo_user=123e4567-e89b-42d3-a456-426614174000",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(response.headers().get(header::SET_COOKIE).is_none());
    let html = body(response).await;
    assert!(html.contains("Connected"));
    assert!(html.contains("Disconnect"));
    assert!(html.contains("Try it"));
    assert!(html.contains("class=\"ajax\""));
    assert!(html.contains("/demo/connect/api-app"));
}

#[tokio::test]
async fn connect_redirect_uses_same_demo_user_and_callback() {
    let server = MockServer::start().await;
    Mock::given(method("POST")).and(path("/v1/connect-sessions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"connect_url":"https://connect.test/authorize","expires_at":"2026-10-30T10:00:00Z"})))
        .mount(&server).await;
    let response = router(state(&server))
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/demo/connect/linear")
                .header(
                    header::COOKIE,
                    "connect_demo_user=123e4567-e89b-42d3-a456-426614174000",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        response.headers().get(header::LOCATION).unwrap(),
        "https://connect.test/authorize"
    );
    let requests = server.received_requests().await.unwrap();
    let payload: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(
        payload["external_user_id"],
        "123e4567-e89b-42d3-a456-426614174000"
    );
    assert_eq!(
        payload["redirect_url"],
        "https://demo.test/demo/connected?app=linear"
    );
}

#[tokio::test]
async fn callback_page_escapes_vendor_error() {
    let server = MockServer::start().await;
    let response = router(state(&server))
        .oneshot(
            Request::builder()
                .uri("/demo/connected?app=linear&status=error&reason=%3Cscript%3E")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let html = body(response).await;
    assert!(html.contains("Could not connect linear"));
    assert!(html.contains("Could not connect linear: &lt;script&gt;</p>"));
}

#[tokio::test]
async fn mcp_handlers_initialize_and_forward_session_for_sse_list_and_call() {
    let server = MockServer::start().await;
    Mock::given(method("POST")).and(path("/v1/users/123e4567-e89b-42d3-a456-426614174000/mcp/linear"))
        .respond_with(|request: &wiremock::Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            match body["method"].as_str().unwrap() {
                "initialize" => ResponseTemplate::new(200).insert_header("content-type", "text/event-stream").insert_header("mcp-session-id", "session-123").set_body_raw("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\"}}\n\n", "text/event-stream"),
                "notifications/initialized" => ResponseTemplate::new(202),
                "tools/list" => ResponseTemplate::new(200).set_body_json(json!({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"find","description":"Find <items>"}]}})),
                "tools/call" => ResponseTemplate::new(200).set_body_json(json!({"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"<secret>"}]}})),
                _ => ResponseTemplate::new(400),
            }
        }).mount(&server).await;
    let app = router(state(&server));
    let cookie = "connect_demo_user=123e4567-e89b-42d3-a456-426614174000";
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/demo/apps/linear/tools")
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = body(response).await;
    assert!(html.contains("Find &lt;items&gt;"));
    assert!(html.contains("name=\"arguments\""));
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/demo/apps/linear/call")
                .header(header::COOKIE, cookie)
                .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(Body::from(
                    "name=find&arguments=%7B%22query%22%3A%22hello%22%7D",
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = body(response).await;
    assert!(html.contains("&lt;secret&gt;"));
    assert!(!html.contains("<secret>"));
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 6);
    for request in requests.iter().filter(|request| {
        !request
            .body
            .windows(10)
            .any(|window| window == b"initialize")
    }) {
        assert_eq!(
            request.headers.get("mcp-session-id").unwrap(),
            "session-123"
        );
        assert_eq!(
            request.headers.get("mcp-protocol-version").unwrap(),
            "2025-06-18"
        );
    }
    let call: Value = serde_json::from_slice(&requests[5].body).unwrap();
    assert_eq!(call["params"]["arguments"]["query"], "hello");
}

#[test]
fn tool_results_expand_json_text_only() {
    let value = json!({"content": [
        {"type": "text", "text": "{\"teams\":[{\"key\":\"MAC\"}]}"},
        {"type": "text", "text": "plain words"},
        {"type": "text", "text": "42"}
    ]});
    let expanded = expand_text_json(value);
    assert_eq!(expanded["content"][0]["text"]["teams"][0]["key"], "MAC");
    assert_eq!(expanded["content"][1]["text"], "plain words");
    assert_eq!(expanded["content"][2]["text"], "42");
}
