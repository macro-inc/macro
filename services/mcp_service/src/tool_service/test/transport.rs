//! Real HTTP MCP round trips, including a form response arriving on a second replica.
use super::*;
use crate::session_routing::{
    directory::{Directory, Owner},
    route_sessions,
};
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::IntoResponse,
};
use futures::StreamExt;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Mutex};

#[derive(Clone, Default)]
struct TestDirectory(Arc<Mutex<HashMap<String, Owner>>>);
#[async_trait::async_trait]
impl Directory for TestDirectory {
    async fn lookup(&self, id: &str) -> Result<Option<Owner>, String> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    async fn register(&self, id: &str, owner: &Owner) -> Result<(), String> {
        self.0.lock().unwrap().insert(id.to_owned(), owner.clone());
        Ok(())
    }
    async fn remove(&self, id: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(id);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct TestContext(Arc<Mutex<Vec<String>>>);
#[async_trait::async_trait]
impl MarkdownImageResolver for TestContext {
    async fn resolve_static(&self, _: &str) -> Option<crate::markdown_images::ResolvedImage> {
        None
    }
    async fn resolve_dss(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &str,
    ) -> Option<crate::markdown_images::ResolvedImage> {
        None
    }
}
impl McpToolContext for TestContext {
    fn for_user(&self, _: MacroUserIdStr<'static>) -> Self {
        self.clone()
    }
}
#[derive(serde::Deserialize, schemars::JsonSchema)]
#[schemars(title = "ReviewedNote", description = "Send a reviewed test note.")]
struct ReviewedNote {
    text: String,
}
impl ToolAnnotated for ReviewedNote {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Review note");
}
#[async_trait::async_trait]
impl AsyncTool<TestContext> for ReviewedNote {
    type Output = String;
    async fn call(
        &self,
        context: ServiceContext<TestContext>,
        _: RequestContext,
    ) -> ToolResult<String> {
        context.0.0.lock().unwrap().push(self.text.clone());
        Ok(self.text.clone())
    }
}

async fn replica(
    directory: TestDirectory,
    context: TestContext,
    process: &str,
) -> (String, tokio::task::JoinHandle<()>) {
    let (url, task, _) = replica_with_lifetime(
        directory,
        context,
        process,
        std::time::Duration::from_secs(3660),
        Default::default(),
    )
    .await;
    (url, task)
}

async fn replica_with_lifetime(
    directory: TestDirectory,
    context: TestContext,
    process: &str,
    idle: std::time::Duration,
    shutdown: tokio_util::sync::CancellationToken,
) -> (
    String,
    tokio::task::JoinHandle<()>,
    Arc<rmcp::transport::streamable_http_server::session::local::LocalSessionManager>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mut sessions =
        rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default();
    sessions.session_config.keep_alive = Some(idle);
    let sessions = Arc::new(sessions);
    let local = StreamableHttpService::new(
        move || {
            Ok(AuthenticatedToolService::new(
                Arc::new(AsyncToolCollection::new().add_user_tool::<ReviewedNote, TestContext>()),
                context.clone(),
                "https://macro.com".into(),
            ))
        },
        sessions.clone(),
        StreamableHttpServerConfig::default().with_cancellation_token(shutdown.clone()),
    );
    let routed = route_sessions(
        local,
        directory,
        process.into(),
        address,
        "localhost".into(),
        sessions.clone(),
    );
    // Replace JWT verification with two already-verified principals at the boundary.
    let app = axum::Router::new()
        .nest_service("/mcp", routed)
        .layer(axum::middleware::from_fn(
            |mut request: Request<Body>, next: axum::middleware::Next| async move {
                let email = match request
                    .headers()
                    .get("authorization")
                    .and_then(|h| h.to_str().ok())
                {
                    Some("Bearer alice") => "alice@example.com",
                    Some("Bearer bob") => "bob@example.com",
                    _ => return StatusCode::UNAUTHORIZED.into_response(),
                };
                request
                    .extensions_mut()
                    .insert(MacroUserIdStr::try_from_email(email).unwrap());
                next.run(request).await
            },
        ));
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown.cancelled_owned())
            .await
            .unwrap();
    });
    (format!("http://{address}/mcp"), task, sessions)
}

fn post(
    client: &reqwest::Client,
    url: &str,
    session: Option<&str>,
    message: Value,
) -> reqwest::RequestBuilder {
    let request = client
        .post(url)
        .bearer_auth("alice")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2025-11-25")
        .json(&message);
    match session {
        Some(id) => request.header("mcp-session-id", id),
        None => request,
    }
}

async fn initialize(client: &reqwest::Client, url: &str, form: bool) -> String {
    let capabilities = if form {
        json!({"elicitation":{"form":{}}})
    } else {
        json!({})
    };
    let response = post(client, url, None, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25", "capabilities":capabilities, "clientInfo":{"name":"probe","version":"1"}
    }})).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let session = response.headers()["mcp-session-id"]
        .to_str()
        .unwrap()
        .to_owned();
    post(
        client,
        url,
        Some(&session),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .send()
    .await
    .unwrap()
    .error_for_status()
    .unwrap();
    session
}

#[tokio::test]
async fn reviewed_tools_round_trip_across_replicas_and_never_execute_on_refusal() {
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let directory = TestDirectory::default();
        let context = TestContext::default();
        let (a, a_task) = replica(directory.clone(), context.clone(), "a").await;
        let (b, b_task) = replica(directory.clone(), context.clone(), "b").await;
        let client = reqwest::Client::new();
        let session = initialize(&client, &a, true).await;
        let events = client.get(&b).bearer_auth("alice").header("mcp-session-id", &session)
            .header("accept", "text/event-stream").header("mcp-protocol-version", "2025-11-25")
            .send().await.unwrap().error_for_status().unwrap();
        let mut questions = events.bytes_stream();
        // Tool request, elicitation answer, and subsequent calls can land on different replicas.
        for (index, answer) in [
            json!({"action":"accept","content":{"text":"edited"}}),
            json!({"action":"decline"}),
            json!({"action":"cancel"}),
            json!({"action":"accept","content":{"draft":"invalid json"}}),
            json!({"action":"accept","content":{"text":42}}),
        ].into_iter().enumerate() {
            let response = post(&client, &b, Some(&session), json!({"jsonrpc":"2.0","id":index+10,"method":"tools/call","params":{"name":"ReviewedNote","arguments":{"text":"original"}}}))
                .send().await.unwrap().error_for_status().unwrap();
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let elicitation = loop {
                let chunk = questions.next().await.expect("SSE remains open").unwrap();
                buffer.push_str(std::str::from_utf8(&chunk).unwrap());
                if let Some(message) = buffer.lines().filter_map(|line| line.strip_prefix("data: "))
                    .filter_map(|data| serde_json::from_str::<Value>(data).ok())
                    .find(|v| v["method"] == "elicitation/create") { break message; }
            };
            assert_eq!(elicitation["params"]["requestedSchema"]["properties"]["draft"]["type"], "string");
            assert_eq!(elicitation["params"]["_meta"]["macro"]["userTool"]["name"], "ReviewedNote");
            assert_eq!(client.post(&b).bearer_auth("bob").header("mcp-session-id", &session).json(&json!({"jsonrpc":"2.0","id":elicitation["id"],"result":answer})).send().await.unwrap().status(), StatusCode::FORBIDDEN);
            post(&client, &b, Some(&session), json!({"jsonrpc":"2.0","id":elicitation["id"],"result":answer})).send().await.unwrap().error_for_status().unwrap();
            while let Some(chunk) = stream.next().await { buffer.push_str(std::str::from_utf8(&chunk.unwrap()).unwrap()); }
            let final_result = buffer.lines().filter_map(|line| line.strip_prefix("data: "))
                .filter_map(|data| serde_json::from_str::<Value>(data).ok())
                .find(|value| value["id"] == index + 10).expect("the tool result");
            let structured = &final_result["result"]["structuredContent"];
            assert!(structured.is_null() || structured.is_object());
            if index == 1 { assert_eq!(final_result["result"]["content"][0]["text"], "Rejected"); }
            assert_eq!(*context.0.lock().unwrap(), vec!["edited"]);
        }
        let unsupported = initialize(&client, &a, false).await;
        let response = post(&client, &b, Some(&unsupported), json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ReviewedNote","arguments":{"text":"must not run"}}})).send().await.unwrap().text().await.unwrap();
        assert!(response.contains("requires form elicitation"), "{response}");
        assert_eq!(*context.0.lock().unwrap(), vec!["edited"]);
        // Dead owners expire the session; never run an uncertain mutation elsewhere.
        directory.remove(&session).await.unwrap();
        assert_eq!(post(&client, &b, Some(&session), json!({"jsonrpc":"2.0","id":100,"method":"tools/call","params":{"name":"ReviewedNote","arguments":{"text":"no replay"}}})).send().await.unwrap().status(), StatusCode::NOT_FOUND);
        a_task.abort(); b_task.abort();
    }).await.expect("elicitation round trip must complete");
}

#[tokio::test]
async fn expired_local_worker_is_removed_and_returns_not_found() {
    let directory = TestDirectory::default();
    let shutdown = tokio_util::sync::CancellationToken::new();
    let (url, task, sessions) = replica_with_lifetime(
        directory.clone(),
        Default::default(),
        "short-lived",
        std::time::Duration::from_millis(100),
        shutdown.clone(),
    )
    .await;
    let client = reqwest::Client::new();
    let id = initialize(&client, &url, true).await;
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let response = post(
        &client,
        &url,
        Some(&id),
        json!({"jsonrpc":"2.0","id":3,"method":"ping"}),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(sessions.sessions.read().await.is_empty());
    assert!(directory.lookup(&id).await.unwrap().is_none());
    shutdown.cancel();
    tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn shutdown_releases_a_pending_review_without_executing_it() {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let directory = TestDirectory::default();
        let context = TestContext::default();
        let shutdown = tokio_util::sync::CancellationToken::new();
        let (url, task, _) = replica_with_lifetime(directory.clone(), context.clone(), "old-process", std::time::Duration::from_secs(3660), shutdown.clone()).await;
        let client = reqwest::Client::new();
        let id = initialize(&client, &url, true).await;
        let mut questions = client.get(&url).bearer_auth("alice").header("mcp-session-id", &id).header("accept", "text/event-stream").send().await.unwrap().bytes_stream();
        let response = post(&client, &url, Some(&id), json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"ReviewedNote","arguments":{"text":"never run"}}})).send().await.unwrap();
        let mut seen = String::new();
        while !seen.contains("elicitation/create") {
            let chunk = questions.next().await.unwrap().unwrap();
            seen.push_str(std::str::from_utf8(&chunk).unwrap());
        }
        // Retirement makes the old session unroutable before streams close.
        directory.remove(&id).await.unwrap();
        shutdown.cancel();
        let _ = response.bytes().await;
        drop(questions);
        task.await.unwrap();
        assert!(context.0.lock().unwrap().is_empty());
        let (new_url, new_task) = replica(directory, context.clone(), "replacement").await;
        assert_eq!(post(&client, &new_url, Some(&id), json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"ReviewedNote","arguments":{"text":"no replay"}}})).send().await.unwrap().status(), StatusCode::NOT_FOUND);
        assert!(context.0.lock().unwrap().is_empty());
        new_task.abort();
    }).await.unwrap();
}

#[tokio::test]
async fn sessionless_tool_calls_are_rejected_without_allocating_workers() {
    let shutdown = tokio_util::sync::CancellationToken::new();
    let (url, task, sessions) = replica_with_lifetime(
        Default::default(),
        Default::default(),
        "a",
        std::time::Duration::from_secs(3660),
        shutdown.clone(),
    )
    .await;
    let client = reqwest::Client::new();
    for id in 0..3 {
        let response = post(&client, &url, None, json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"ReviewedNote","arguments":{"text":"no session"}}})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let response = post(
        &client,
        &url,
        None,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","result":{}}),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(sessions.sessions.read().await.is_empty());
    shutdown.cancel();
    task.await.unwrap();
}
