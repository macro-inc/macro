use super::*;
use agent_egress::domain::model::SessionToken;
use axum::http::StatusCode;

#[test]
fn task_tools_accept_only_a_task() {
    let tools = toolset();
    for name in ["link_task", "task_pull_requests"] {
        let tool = tools.tools.get(name).unwrap();
        assert_eq!(tool.input_schema["additionalProperties"], false, "{name}");
        assert_eq!(
            tool.input_schema["required"],
            serde_json::json!(["task"]),
            "{name}"
        );
    }
    assert!(
        tools.tools["task_pull_requests"]
            .annotations
            .kind
            .read_only_hint()
    );
}

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
        session_task::{
            LinkedTask, PullRequestState, SessionTaskError, SessionTasks, TaskPullRequest,
            TaskPullRequests,
        },
    },
    testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session},
};
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use bot_id::BotId;
use bots::domain::{
    models::{AgentMemory, UpdateAgentMemoryRequest},
    ports::BotError,
};
use tower::ServiceExt;

type BoxFuture<'a, T> = std::pin::Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Answers task tools with fixed values and records which session linked what.
#[derive(Clone, Default)]
struct FixedTasks {
    linked: Arc<std::sync::Mutex<Vec<(AgentSessionId, String)>>>,
}

impl SessionTasks for FixedTasks {
    fn link_task<'a>(
        &'a self,
        session: AgentSessionId,
        _owner: &'a macro_user_id::user_id::MacroUserIdStr<'static>,
        task: &'a str,
    ) -> BoxFuture<'a, Result<LinkedTask, SessionTaskError>> {
        self.linked.lock().unwrap().push((session, task.to_owned()));
        Box::pin(async move {
            Ok(LinkedTask {
                task_id: task.to_owned(),
                title: "Fix the thing".into(),
                url: format!("https://macro.com/app/task/{task}"),
                reference: "ENG-42".into(),
                mention: format!(
                    r#"<m-document-mention>{{"documentId":"{task}","blockName":"task","documentName":"Fix the thing","blockParams":{{}},"collapsed":false}}</m-document-mention>"#
                ),
                pull_request: None,
            })
        })
    }

    fn task_pull_requests<'a>(
        &'a self,
        _owner: &'a macro_user_id::user_id::MacroUserIdStr<'static>,
        task: &'a str,
    ) -> BoxFuture<'a, Result<TaskPullRequests, SessionTaskError>> {
        Box::pin(async move {
            Ok(TaskPullRequests {
                task_id: task.to_owned(),
                pull_requests: vec![TaskPullRequest {
                    url: "https://github.com/org/repo/pull/1".into(),
                    title: Some("Fix the thing".into()),
                    state: Some(PullRequestState::Open),
                }],
            })
        })
    }

    fn link_session_pull_request<'a>(
        &'a self,
        _session: AgentSessionId,
        _owner: &'a macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> BoxFuture<'a, Result<(), SessionTaskError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Each agent's memory, kept in process, compare-and-swapped on revision.
#[derive(Clone, Default)]
struct FakeAgentMemory {
    memories: Arc<std::sync::Mutex<std::collections::HashMap<BotId, AgentMemory>>>,
}

#[async_trait::async_trait]
impl OwnAgentMemory for FakeAgentMemory {
    async fn read(&self, bot: BotId) -> Result<AgentMemory, BotError> {
        Ok(self
            .memories
            .lock()
            .unwrap()
            .get(&bot)
            .cloned()
            .unwrap_or_else(AgentMemory::empty))
    }

    async fn write(
        &self,
        bot: BotId,
        req: UpdateAgentMemoryRequest,
    ) -> Result<AgentMemory, BotError> {
        let mut memories = self.memories.lock().unwrap();
        let current = memories.get(&bot).map_or(0, |memory| memory.revision);
        if current != req.revision {
            return Err(BotError::Conflict("stale".to_owned()));
        }
        let memory = AgentMemory {
            content: req.content,
            revision: current + 1,
            updated_at: None,
        };
        memories.insert(bot, memory.clone());
        Ok(memory)
    }
}

fn memory_app(repo: InMemoryAgentSessionRepo, memory: FakeAgentMemory) -> Router {
    let tasks = FixedTasks::default();
    router(
        Arc::new(repo.clone()),
        "localhost".into(),
        InternalTools {
            service: Arc::new(SessionPullRequestService::new(
                repo,
                RecordingRealtime::new(),
                Arc::new(tasks.clone()),
            )),
            tasks: Arc::new(tasks),
            code_mode: None,
            cognition: None,
            reviews: Arc::new(OnceLock::new()),
            gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
            agent_memory: Arc::new(memory),
            app_url: "https://macro.com".into(),
        },
    )
}

#[tokio::test]
async fn memory_tools_change_only_the_calling_sessions_agent() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
        .await
        .unwrap();
    let memory = FakeAgentMemory::default();
    let app = memory_app(repo, memory.clone());

    let (_, updated) = rpc(
        app.clone(),
        Some("secret"),
        "tools/call",
        serde_json::json!({
            "name": "UpdateAgentMemory",
            "arguments": {"revision": 0, "content": "- The team ships on Thursdays."},
        }),
    )
    .await;
    assert_ne!(updated["result"]["isError"], true, "{updated}");
    assert_eq!(updated["result"]["structuredContent"]["revision"], 1);
    assert_eq!(
        memory.memories.lock().unwrap().keys().collect::<Vec<_>>(),
        [&session.bot_id]
    );

    let (_, read) = rpc(
        app.clone(),
        Some("secret"),
        "tools/call",
        serde_json::json!({"name": "ReadAgentMemory", "arguments": {}}),
    )
    .await;
    assert_eq!(
        read["result"]["structuredContent"],
        serde_json::json!({
            "content": "- The team ships on Thursdays.",
            "revision": 1,
            "updated_at": null,
        })
    );

    let (_, stale) = rpc(
        app,
        Some("secret"),
        "tools/call",
        serde_json::json!({
            "name": "UpdateAgentMemory",
            "arguments": {"revision": 0, "content": "- Overwritten."},
        }),
    )
    .await;
    assert_eq!(stale["result"]["isError"], true, "{stale}");
    assert_eq!(
        memory.memories.lock().unwrap()[&session.bot_id].content,
        "- The team ships on Thursdays."
    );
}

#[tokio::test]
async fn a_system_bot_session_is_not_offered_memory_tools() {
    let repo = InMemoryAgentSessionRepo::new();
    let mut session = test_agent_session(AgentSessionId::new());
    session.bot_id = bot_id::MACRO_AI_BOT_ID;
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
        .await
        .unwrap();
    let (_, listed) = rpc(
        memory_app(repo, FakeAgentMemory::default()),
        Some("secret"),
        "tools/list",
        serde_json::json!({}),
    )
    .await;
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert!(!names.contains(&"ReadAgentMemory"), "{names:?}");
    assert!(!names.contains(&"UpdateAgentMemory"), "{names:?}");
}

async fn rpc(
    app: Router,
    token: Option<&str>,
    method: &str,
    params: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    rpc_host(app, token, method, params, "localhost").await
}

async fn rpc_host(
    app: Router,
    token: Option<&str>,
    method: &str,
    mut params: serde_json::Value,
    host: &str,
) -> (StatusCode, serde_json::Value) {
    if method == "tools/call"
        && !matches!(
            params["name"].as_str(),
            Some("DescribeCodeTools" | "ReadCodeDocs")
        )
    {
        params["arguments"]["acting_as"] = serde_json::json!("owner");
    }
    let mut request = Request::builder()
        .method("POST")
        .uri("/mcp/internal")
        .header("host", host)
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
        let tasks = FixedTasks::default();
        let app = router(
            Arc::new(repo.clone()),
            configured_hosts(&[
                "http://agent-harness-service:8102",
                "http://localhost:31327",
                "http://10.210.0.1:31327",
            ])
            .unwrap(),
            InternalTools {
                service: Arc::new(SessionPullRequestService::new(
                    repo.clone(),
                    RecordingRealtime::new(),
                    Arc::new(tasks.clone()),
                )),
                tasks: Arc::new(tasks.clone()),
                code_mode: None,
                cognition: None,
                reviews: Arc::new(OnceLock::new()),
                gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
                agent_memory: Arc::new(FakeAgentMemory::default()),
                app_url: "https://macro.com".into(),
            },
        );
        for (host, expected) in [
            ("10.210.0.1:31327", StatusCode::OK),
            ("unconfigured.test", StatusCode::FORBIDDEN),
        ] {
            assert_eq!(rpc_host(app.clone(), Some("secret"), "initialize", serde_json::json!({
                "protocolVersion":"2025-03-26", "capabilities":{}, "clientInfo":{"name":"test","version":"1"}
            }), host).await.0, expected);
        }
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
        let (status, initialized) = rpc(
            app.clone(),
            Some("secret"),
            "initialize",
            serde_json::json!({
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "1.0.0" },
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{initialized}");
        let instructions = initialized["result"]["instructions"].as_str().unwrap();
        assert!(instructions.contains("macro_internal.set_pull_request"));
        assert!(instructions.contains("register its URL"));
        assert!(instructions.contains(prompt::pull_requests::READY_PULL_REQUEST));
        assert!(instructions.contains("submit it with macro_internal.DecideReview"));
        assert!(instructions.contains("Should I kick it off?"));
        let (status, listed) = rpc(
            app.clone(),
            Some("secret"),
            "tools/list",
            serde_json::json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{listed}");
        let mut names: Vec<&str> = listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        names.sort_unstable();
        assert_eq!(
            names,
            [
                "DecideReview",
                "GetReview",
                "PresentReview",
                "ReadAgentMemory",
                "UpdateAgentMemory",
                "link_task",
                "set_pull_request",
                "task_pull_requests"
            ]
        );
        let description = |name: &str| {
            listed["result"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .find(|tool| tool["name"] == name)
                .and_then(|tool| tool["description"].as_str())
                .unwrap()
                .to_owned()
        };
        assert!(description("PresentReview").contains("Should I kick it off?"));
        assert!(description("DecideReview").contains("Should I kick it off?"));
        assert!(description("DecideReview").contains("not ready yet"));
        let read_review = listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "GetReview")
            .unwrap();
        assert_eq!(read_review["annotations"]["readOnlyHint"], true);
        // The presentation tool is advertised without code mode, but startup
        // wiring must be complete before a call can create a saved review.
        let (_, unavailable) = rpc(
            app.clone(),
            Some("secret"),
            "tools/call",
            serde_json::json!({
                "name": "PresentReview", "arguments": {
                    "kind": "email", "title": "Draft", "drafts": [{"subject":"Review", "body":"Draft body", "to":[{"email":"preview@example.test"}]}]
                },
            }),
        )
        .await;
        assert_eq!(
            unavailable["error"]["message"],
            "Review service is unavailable"
        );
        let (_, linked) = rpc(
            app.clone(),
            Some("secret"),
            "tools/call",
            serde_json::json!({
                "name": "link_task", "arguments": {"task": "MACRO-abc"},
            }),
        )
        .await;
        assert_ne!(linked["result"]["isError"], true, "{linked}");
        let linked: serde_json::Value =
            serde_json::from_str(linked["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(
            linked,
            serde_json::json!({
                "task_id": "MACRO-abc",
                "title": "Fix the thing",
                "url": "https://macro.com/app/task/MACRO-abc",
                "reference": "ENG-42",
                "mention": "<m-document-mention>{\"documentId\":\"MACRO-abc\",\"blockName\":\"task\",\"documentName\":\"Fix the thing\",\"blockParams\":{},\"collapsed\":false}</m-document-mention>",
                "pull_request": null,
            })
        );
        assert_eq!(
            *tasks.linked.lock().unwrap(),
            [(session.id, "MACRO-abc".to_owned())]
        );
        let (_, pull_requests) = rpc(
            app.clone(),
            Some("secret"),
            "tools/call",
            serde_json::json!({
                "name": "task_pull_requests", "arguments": {"task": "MACRO-abc"},
            }),
        )
        .await;
        let pull_requests: serde_json::Value = serde_json::from_str(
            pull_requests["result"]["content"][0]["text"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            pull_requests,
            serde_json::json!({
                "task_id": "MACRO-abc",
                "pull_requests": [{
                    "url": "https://github.com/org/repo/pull/1",
                    "title": "Fix the thing",
                    "state": "open",
                }],
            })
        );
        let (_, bad) = rpc(app.clone(), Some("secret"), "tools/call", serde_json::json!({
            "name": "set_pull_request", "arguments": {"url": "https://github.com/org/repo/pull/1", "session": other.id.as_uuid()},
        })).await;
        assert!(bad.get("error").is_some(), "{bad}");
        let (_, called) = rpc(app.clone(), Some("secret"), "tools/call", serde_json::json!({
            "name": "set_pull_request", "arguments": {"url": "https://github.com/org/repo/pull/1"},
        })).await;
        assert!(called.get("error").is_none(), "{called}");
        assert_ne!(called["result"]["isError"], true, "{called}");
        let output: serde_json::Value =
            serde_json::from_str(called["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(
            output,
            serde_json::json!({
                "pull_request_url": "https://github.com/org/repo/pull/1",
                "session_url": format!("https://macro.com/app/agent/{}", session.id),
            })
        );
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

mod code_mode;
