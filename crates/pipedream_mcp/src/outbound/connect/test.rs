use super::*;
use crate::domain::models::ConnectionProvider;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap as AxumHeaders, StatusCode},
    response::IntoResponse,
    routing::post,
};
use serde_json::{Value, json};
use std::sync::Mutex;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const KEY: &str = "ck_test_macro";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("caller@example.com").unwrap()
}

fn adapter(base: &str) -> ConnectAdapter {
    ConnectAdapter::new(ConnectConfig {
        api_url: base.to_owned(),
        customer_key: KEY.to_owned(),
        callback_url: Url::parse("https://cognition.test/pipedream/mcp/connect/callback").unwrap(),
    })
    .unwrap()
}

fn record(app_slug: &str, app_id: &str) -> PipedreamConnection {
    PipedreamConnection {
        user_id: user(),
        app_slug: app_slug.to_owned(),
        server_name: "Airtable".to_owned(),
        account_id: app_id.to_owned(),
        enabled: true,
        provider: ConnectionProvider::Connect,
    }
}

async fn mount_catalog(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/v1/catalog"))
        .and(header("authorization", format!("Bearer {KEY}").as_str()))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {
                "id": "airtable", "name": "Airtable", "description": "Bases and records",
                "access": ["mcp"], "mcp_url": "https://mcp.airtable.com/mcp",
                "icon_url": "/v1/catalog/airtable/icon.svg",
                "oauth_client": "managed_oauth_app",
                "pipedream_app_slugs": ["airtable_oauth"]
            },
            {
                "id": "slack", "name": "Slack", "description": "Messages",
                "access": ["mcp"], "mcp_url": "https://mcp.slack.com/mcp", "icon_url": null,
                "pipedream_app_slugs": ["slack", "slack_v2"]
            },
            {
                "id": "mercury", "name": "Mercury", "description": "Bank accounts",
                "access": ["mcp"], "mcp_url": "https://mcp.mercury.com/mcp", "icon_url": null,
                "pipedream_app_slugs": []
            }
        ])))
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn maps_pipedream_slugs_to_connect_apps_from_one_cached_catalog() {
    let server = MockServer::start().await;
    mount_catalog(&server).await;
    let connect = adapter(&server.uri());

    let airtable = connect
        .app_for_slug("airtable_oauth")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(airtable.app_id, "airtable");
    assert_eq!(airtable.app_slug, "airtable_oauth");
    assert_eq!(airtable.name, "Airtable");
    let slack = connect.app_for_slug("slack_v2").await.unwrap().unwrap();
    assert_eq!(
        (slack.app_id.as_str(), slack.app_slug.as_str()),
        ("slack", "slack_v2")
    );
    assert_eq!(connect.app_for_slug("airtable").await.unwrap(), None);

    let entry = connect
        .retrieve(&user(), "airtable_oauth")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        entry.icon_url.as_deref(),
        Some(format!("{}/v1/catalog/airtable/icon.svg", server.uri()).as_str())
    );
    let page = connect
        .search(&user(), Some("sla"), None, 10)
        .await
        .unwrap();
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].app_slug, "slack");

    // An app Pipedream doesn't have goes by its Connect id.
    let mercury = connect.app_for_slug("mercury").await.unwrap().unwrap();
    assert_eq!(mercury.app_id, "mercury");
    assert!(
        connect
            .retrieve(&user(), "mercury")
            .await
            .unwrap()
            .is_some()
    );
    let page = connect
        .search(&user(), Some("merc"), None, 10)
        .await
        .unwrap();
    assert_eq!(page.entries[0].app_slug, "mercury");
    // `expect(1)` on the catalog mock checks the cache on drop.
}

#[tokio::test]
async fn connect_session_redirects_back_with_the_app_slug() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/connect-sessions"))
        .and(body_json(json!({
            "external_user_id": "macro|caller@example.com",
            "app_id": "airtable",
            "redirect_url": "https://cognition.test/pipedream/mcp/connect/callback?app_slug=airtable_oauth"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "connect_url": "https://connect.test/v1/connect/tok",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let url = adapter(&server.uri())
        .create_connect_session(
            &user(),
            &ConnectApp {
                app_id: "airtable".into(),
                app_slug: "airtable_oauth".into(),
                name: "Airtable".into(),
            },
        )
        .await
        .unwrap();

    assert_eq!(url, "https://connect.test/v1/connect/tok");
}

#[tokio::test]
async fn only_an_active_connection_to_the_app_counts_as_connected() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/users/macro|caller@example.com/connections"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"appId": "airtable", "status": "needs_reauth", "scopes": [], "createdAt": "2026-11-03T00:00:00Z"},
            {"appId": "linear", "status": "active", "scopes": [], "createdAt": "2026-11-03T00:00:00Z"}
        ])))
        .mount(&server)
        .await;
    let connect = adapter(&server.uri());

    assert!(connect.is_connected(&user(), "linear").await.unwrap());
    assert!(!connect.is_connected(&user(), "airtable").await.unwrap());
    assert!(!connect.is_connected(&user(), "notion").await.unwrap());
}

#[tokio::test]
async fn deleting_tolerates_a_connection_connect_already_dropped() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path(
            "/v1/users/macro|caller@example.com/connections/airtable",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"vendorGrantRevoked": false})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(
            "/v1/users/macro|caller@example.com/connections/linear",
        ))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"error": "not_found"})))
        .mount(&server)
        .await;
    let connect = adapter(&server.uri());

    connect
        .delete_connection(&user(), "airtable")
        .await
        .unwrap();
    connect.delete_connection(&user(), "linear").await.unwrap();
}

#[tokio::test]
async fn upstream_is_the_gateway_with_the_customer_key() {
    let connect = adapter("https://connect.test");

    let call = connect
        .upstream(&record("airtable_oauth", "airtable"))
        .await
        .unwrap();

    assert_eq!(
        call.url.as_str(),
        "https://connect.test/v1/users/macro|caller@example.com/mcp/airtable"
    );
    assert_eq!(call.bearer_token, KEY);
    assert!(call.headers.is_empty());
}

#[tokio::test]
async fn proxy_calls_the_app_with_the_exported_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/v1/users/macro|caller@example.com/connections/airtable/token",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"accessToken": "vendor_token"})),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/app/search"))
        .and(header("authorization", "Bearer vendor_token"))
        .and(header("notion-version", "2022-06-28"))
        .and(query_param("q", "x"))
        .and(body_json(json!({"query": "roadmap"})))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "3"))
        .mount(&server)
        .await;
    let mut headers = http::HeaderMap::new();
    headers.insert("notion-version", "2022-06-28".parse().unwrap());

    let response = adapter(&server.uri())
        .proxy(
            &record("airtable_oauth", "airtable"),
            http::Method::POST,
            &format!("{}/app/search?q=x", server.uri()),
            &headers,
            Some(&json!({"query": "roadmap"})),
        )
        .await
        .unwrap();

    assert_eq!(response.status, http::StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.retry_after(), Some(Duration::from_secs(3)));
}

async fn gateway(
    State(calls): State<Arc<Mutex<Vec<String>>>>,
    Path((user_id, app_id)): Path<(String, String)>,
    headers: AxumHeaders,
    Json(body): Json<Value>,
) -> axum::response::Response {
    assert_eq!(headers["authorization"], format!("Bearer {KEY}"));
    assert_eq!(user_id, "macro|caller@example.com");
    assert_eq!(app_id, "airtable");
    let method = body["method"].as_str().unwrap().to_owned();
    calls.lock().unwrap().push(method.clone());
    let result = match method.as_str() {
        "initialize" => {
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}})
        }
        "notifications/initialized" => return StatusCode::ACCEPTED.into_response(),
        "tools/list" => {
            json!({"tools":[{"name":"list_records","description":"List records","inputSchema":{"type":"object","properties":{}}}]})
        }
        other => panic!("unexpected MCP method {other}"),
    };
    Json(json!({"jsonrpc":"2.0","id":body["id"],"result":result})).into_response()
}

#[tokio::test]
async fn connect_backed_upstream_speaks_mcp_through_the_gateway() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route("/v1/users/{user_id}/mcp/{app_id}", post(gateway))
        .with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let client = adapter(&format!("http://{address}"))
        .connect(&record("airtable_oauth", "airtable"))
        .await
        .unwrap();
    let tools = client.list_all_tools().await.unwrap();
    let _ = client.cancel().await;

    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "list_records");
    assert_eq!(
        *calls.lock().unwrap(),
        ["initialize", "notifications/initialized", "tools/list"]
    );
    server.abort();
}
