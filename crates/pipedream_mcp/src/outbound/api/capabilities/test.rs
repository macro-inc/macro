use super::*;
use crate::outbound::api::PipedreamConfig;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

async fn mcp(
    State(calls): State<Arc<Mutex<Vec<String>>>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    assert_eq!(headers["x-pd-external-user-id"], "macro|caller@example.com");
    assert_eq!(headers["x-pd-app-slug"], "linear");
    let method = body["method"].as_str().unwrap().to_owned();
    calls.lock().unwrap().push(method.clone());
    let result = match method.as_str() {
        "initialize" => {
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}})
        }
        "notifications/initialized" => return StatusCode::ACCEPTED.into_response(),
        "tools/list" => {
            json!({"tools":[{"name":"find_issues","description":"Find Linear issues","inputSchema":{"type":"object","properties":{}}}]})
        }
        other => panic!("Discovery must never invoke a tool: {other}"),
    };
    Json(json!({"jsonrpc":"2.0","id":body["id"],"result":result})).into_response()
}

#[tokio::test]
async fn discovery_uses_real_mcp_handshake_without_executing_tools() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route(
            "/v1/oauth/token",
            post(|| async { Json(json!({"access_token":"fixture","expires_in":3600})) }),
        )
        .route("/mcp", post(mcp))
        .with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = PipedreamClient::new(PipedreamConfig {
        client_id: "fixture".into(),
        client_secret: "fixture".into(),
        project_id: "fixture".into(),
        environment: "development".into(),
        allowed_origins: vec![],
        api_url: format!("http://{address}"),
        mcp_url: format!("http://{address}/mcp"),
    })
    .unwrap();
    let tools = client
        .tools(
            &MacroUserIdStr::try_from_email("caller@example.com").unwrap(),
            "linear",
        )
        .await
        .unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "find_issues");
    assert_eq!(tools[0].description, "Find Linear issues");
    assert_eq!(
        *calls.lock().unwrap(),
        ["initialize", "notifications/initialized", "tools/list"]
    );
    server.abort();
}
