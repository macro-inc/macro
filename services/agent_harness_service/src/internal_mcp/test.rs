use super::*;
use agent_egress::domain::model::SessionToken;
use axum::http::StatusCode;

#[test]
fn tool_schema_accepts_only_a_url() {
    let tools = toolset();
    let tool = tools.tools.get("set_pull_request").unwrap();
    assert_eq!(tool.input_schema["additionalProperties"], false);
    assert_eq!(tool.input_schema["required"], serde_json::json!(["url"]));
    assert_eq!(
        tool.input_schema["properties"].as_object().unwrap().len(),
        1
    );
}

use agent_session::{
    domain::{
        model::{AgentSessionId, SessionStatus},
        ports::{AgentSessionLogRepo, AgentSessionRepo},
        pull_request::SessionPullRequestService,
    },
    testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session},
};
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

async fn rpc(
    app: Router,
    token: Option<&str>,
    method: &str,
    params: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri("/mcp/internal")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = app
        .oneshot(
            request
                .body(Body::from(
                    serde_json::json!({
                        "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or_default())
}

#[tokio::test]
async fn each_harness_gets_only_internal_tools_and_writes_only_its_session() {
    for harness in ["cursor", "claude-code", "macrod"] {
        let repo = InMemoryAgentSessionRepo::new();
        let mut session = test_agent_session(AgentSessionId::new());
        session.harness = harness.into();
        session.repo_url = Some("git@github.com:org/repo.git".into());
        repo.insert_session(session.clone());
        let other = test_agent_session(AgentSessionId::new());
        repo.insert_session(other.clone());
        repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
            .await
            .unwrap();
        let app = router(
            Arc::new(repo.clone()),
            Arc::new(SessionPullRequestService::new(
                repo.clone(),
                RecordingRealtime::new(),
            )),
            "localhost".into(),
        );
        assert_eq!(
            rpc(app.clone(), None, "tools/list", serde_json::json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            rpc(
                app.clone(),
                Some("wrong"),
                "tools/list",
                serde_json::json!({})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        let (status, listed) = rpc(
            app.clone(),
            Some("secret"),
            "tools/list",
            serde_json::json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{listed}");
        assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 1);
        assert_eq!(listed["result"]["tools"][0]["name"], "set_pull_request");
        let (_, bad) = rpc(app.clone(), Some("secret"), "tools/call", serde_json::json!({
            "name": "set_pull_request", "arguments": {"url": "https://github.com/org/repo/pull/1", "session": other.id.as_uuid()},
        })).await;
        assert!(bad.get("error").is_some(), "{bad}");
        let (_, called) = rpc(app.clone(), Some("secret"), "tools/call", serde_json::json!({
            "name": "set_pull_request", "arguments": {"url": "https://github.com/org/repo/pull/1"},
        })).await;
        assert!(called.get("error").is_none(), "{called}");
        assert_ne!(called["result"]["isError"], true, "{called}");
        assert_eq!(
            repo.get(session.id)
                .await
                .unwrap()
                .pull_request_url
                .as_deref(),
            Some("https://github.com/org/repo/pull/1")
        );
        assert_eq!(repo.get(other.id).await.unwrap().pull_request_url, None);
        assert!(repo.list_by_session(session.id).await.unwrap().is_empty());
        assert!(repo.list_by_session(other.id).await.unwrap().is_empty());
        repo.set_egress_token_hash(session.id, &SessionToken::new("rotated").hash())
            .await
            .unwrap();
        assert_eq!(
            rpc(
                app.clone(),
                Some("secret"),
                "tools/list",
                serde_json::json!({})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        session.status = SessionStatus::Disconnected;
        repo.insert_session(session);
        assert_eq!(
            rpc(app, Some("rotated"), "tools/list", serde_json::json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
    }
}
