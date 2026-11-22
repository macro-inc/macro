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

/// A `server/discover` handshake, as a 2026-07-28 client opens with.
async fn discover(app: Router, token: &str) -> serde_json::Value {
    let version = rmcp::model::ProtocolVersion::V_2026_07_28.to_string();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp/internal")
                .header("host", "localhost")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .header("mcp-protocol-version", &version)
                .header("mcp-method", "server/discover")
                .body(Body::from(
                    serde_json::json!({
                        "jsonrpc": "2.0", "id": 1, "method": "server/discover",
                        "params": {"_meta": {
                            "io.modelcontextprotocol/protocolVersion": version,
                            "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "1"},
                            "io.modelcontextprotocol/clientCapabilities": {},
                        }},
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap_or_default()
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
                app_url: "https://macro.com".into(),
                permissions: None,
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
mod trace;

#[test]
fn code_results_send_pixels_as_images_and_keep_the_receipt_structured() {
    let receipt = serde_json::json!({
        "executionId": "e",
        "status": "succeeded",
        "result": {"data": 1, "reviews": [], "images": [{"id": "render-1"}]},
        "modelMedia": [{"type": "image", "mediaType": "image/png", "data": "iVBORw0KGgo="}],
    });
    let result = code_result(receipt.clone());
    assert_eq!(result.structured_content, Some(receipt));
    let text = result.content[0].as_text().unwrap();
    assert!(!text.text.contains("iVBORw0KGgo"), "{}", text.text);
    let image = result.content[1].as_image().unwrap();
    assert_eq!(
        (image.data.as_str(), image.mime_type.as_str()),
        ("iVBORw0KGgo=", "image/png")
    );
    assert_eq!(result.content.len(), 2);
}

/// Code mode whose JS tools rollout is fixed, recording each run's
/// language.
struct OwnerRollout {
    js_tools: bool,
    languages: std::sync::Mutex<Vec<code_execution::domain::Language>>,
}

#[async_trait::async_trait]
impl SessionCodeMode for OwnerRollout {
    async fn execute(
        &self,
        _: &agent_session::domain::model::AgentSession,
        execution: agent_code_mode::domain::ExecutionId,
        _: ai_toolset::actor::ToolActor,
        _: macro_uuid::Uuid,
        request: code_execution::domain::ExecuteRequest,
        _: tokio_util::sync::CancellationToken,
    ) -> Result<agent_code_mode::domain::ExecutionReceipt, agent_code_mode::domain::CodeModeError>
    {
        self.languages.lock().unwrap().push(request.language);
        Ok(agent_code_mode::domain::ExecutionReceipt {
            execution_id: execution,
            status: agent_code_mode::domain::ExecutionStatus::Succeeded,
            activity: Vec::new(),
            result: None,
            error: None,
            model_media: Vec::new(),
            permission: None,
        })
    }
    async fn read(
        &self,
        _: &entity_access::domain::models::EntityAccessReceipt<
            entity_access::domain::models::ViewAccessLevel,
        >,
        _: agent_code_mode::domain::ExecutionId,
    ) -> Result<agent_code_mode::domain::ExecutionRecord, agent_code_mode::domain::CodeModeError>
    {
        Err(agent_code_mode::domain::CodeModeError::NotFound)
    }
}

#[async_trait::async_trait]
impl agent_code_mode::domain::CodeModeKinds for OwnerRollout {
    async fn code_mode_kind(
        &self,
        _: AgentSessionId,
        _: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> agent_code_mode::domain::CodeModeKind {
        if self.js_tools {
            agent_code_mode::domain::CodeModeKind::Dialect
        } else {
            agent_code_mode::domain::CodeModeKind::TypeScript
        }
    }
}

/// JavaScript tools programs are offered, with ShowPermissions, only to a
/// session whose owner has agent permissions, which gate them.
#[tokio::test]
async fn execute_code_offers_and_accepts_js_tools_only_with_permissions() {
    for js_tools in [false, true] {
        let repo = InMemoryAgentSessionRepo::new();
        let session = test_agent_session(AgentSessionId::new());
        repo.insert_session(session.clone());
        repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
            .await
            .unwrap();
        let tasks = FixedTasks::default();
        let code_mode = Arc::new(OwnerRollout {
            js_tools,
            languages: Default::default(),
        });
        let app = router(
            Arc::new(repo.clone()),
            configured_hosts(&["http://agent-harness-service:8102"]).unwrap(),
            InternalTools {
                service: Arc::new(SessionPullRequestService::new(
                    repo.clone(),
                    RecordingRealtime::new(),
                    Arc::new(tasks.clone()),
                )),
                tasks: Arc::new(tasks),
                code_mode: Some(code_mode.clone()),
                cognition: None,
                reviews: Arc::new(OnceLock::new()),
                gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
                app_url: "https://macro.com".into(),
                permissions: Some(Arc::new(Unrestricted)),
            },
        );
        // The server's instructions describe the turn's kind of code.
        let (_, initialized) = rpc(
            app.clone(),
            Some("secret"),
            "initialize",
            serde_json::json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1"},
            }),
        )
        .await;
        let instructions = initialized["result"]["instructions"].as_str().unwrap();
        assert_eq!(
            instructions.contains("tools.<service>.<operation>"),
            js_tools
        );
        assert_eq!(instructions.contains("TypeScript main module"), !js_tools);
        // So do the 2026-07-28 lifecycle's, which skip `initialize`.
        let discovered = discover(app.clone(), "secret").await;
        let instructions = discovered["result"]["instructions"]
            .as_str()
            .unwrap_or_else(|| panic!("{discovered}"));
        assert_eq!(instructions.contains(DIALECT_CODE_TOOLS), js_tools);
        assert_eq!(instructions.contains(TYPESCRIPT_CODE_TOOLS), !js_tools);
        let (status, listed) = rpc(
            app.clone(),
            Some("secret"),
            "tools/list",
            serde_json::json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{listed}");
        let tools = listed["result"]["tools"].as_array().unwrap();
        let execute = tools
            .iter()
            .find(|tool| tool["name"] == "ExecuteCode")
            .unwrap();
        // A dialect turn's ExecuteCode takes a module, and no language.
        assert_eq!(
            execute["inputSchema"]["properties"].get("module").is_some(),
            js_tools
        );
        assert!(
            execute["inputSchema"]["properties"]
                .get("language")
                .is_none()
        );
        assert_eq!(
            execute["description"]
                .as_str()
                .unwrap()
                .contains("tools.<service>.<operation>"),
            js_tools
        );
        assert_eq!(
            tools.iter().any(|tool| tool["name"] == "ShowPermissions"),
            js_tools
        );
        // Off, ShowPermissions is refused even when named directly.
        let (_, shown) = rpc(
            app.clone(),
            Some("secret"),
            "tools/call",
            serde_json::json!({
                "name": "ShowPermissions",
                "arguments": {"groups": [{"group": "email"}]},
            }),
        )
        .await;
        assert_eq!(
            shown.to_string().contains("not available in this session"),
            !js_tools,
            "{shown}"
        );
        let (_, called) = rpc(
            app,
            Some("secret"),
            "tools/call",
            serde_json::json!({
                "name": "ExecuteCode",
                "arguments": {
                    "turn_id": "00000000-0000-0000-0000-000000000001",
                    "source": "return await tools.storage.get_document_markdown({path: {document_id: \"d\"}})",
                    "module": "export const x = 1;",
                },
            }),
        )
        .await;
        if js_tools {
            assert!(called.get("error").is_none(), "{called}");
            assert_eq!(
                *code_mode.languages.lock().unwrap(),
                [code_execution::domain::Language::JsTools]
            );
        } else {
            // A TypeScript turn's ExecuteCode takes no module: refused unrun.
            assert!(called.get("error").is_some(), "{called}");
            assert!(code_mode.languages.lock().unwrap().is_empty());
        }
    }
}

/// Permissions whose view is the registry with nothing set.
struct Unrestricted;

#[async_trait::async_trait]
impl agent_permissions::domain::service::AgentPermissions for Unrestricted {
    async fn catalog(
        &self,
        _: &agent_permissions::domain::model::Caller,
    ) -> Result<
        agent_permissions::domain::model::ToolPermissionCatalog,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn view_agent(
        &self,
        _: &agent_permissions::domain::model::Caller,
        agent: bot_id::BotId,
    ) -> Result<
        agent_permissions::domain::model::PermissionsView,
        agent_permissions::domain::model::PermissionError,
    > {
        Ok(agent_permissions::domain::resolve::view(
            &agent_permissions::outbound::registry::registry_catalog(),
            agent,
            agent_permissions::domain::model::PolicyKind::Agent,
            agent_permissions::domain::resolve::ViewAccess {
                can_edit: false,
                can_tighten: true,
            },
            Vec::new(),
            None,
        ))
    }
    async fn view_session(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: &entity_access::domain::models::EntityAccessReceipt<
            entity_access::domain::models::ViewAccessLevel,
        >,
    ) -> Result<
        agent_permissions::domain::model::PermissionsView,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn set(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: bot_id::BotId,
        _: Vec<agent_permissions::domain::model::Change>,
    ) -> Result<
        agent_permissions::domain::model::PermissionsView,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn tighten(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: bot_id::BotId,
        _: Vec<agent_permissions::domain::model::Change>,
    ) -> Result<
        agent_permissions::domain::model::Tightened,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn reset(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: bot_id::BotId,
    ) -> Result<
        agent_permissions::domain::model::PermissionsView,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn resolve_calls(
        &self,
        _: &agent_permissions::domain::model::SessionPolicy,
        _: &[agent_permissions::domain::model::OperationKey],
    ) -> Result<
        Vec<agent_permissions::domain::model::ResolvedCall>,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
}

#[tokio::test]
async fn show_permissions_is_offered_only_where_permissions_gate_js_tools() {
    for js_tools in [false, true] {
        let repo = InMemoryAgentSessionRepo::new();
        let session = test_agent_session(AgentSessionId::new());
        repo.insert_session(session.clone());
        repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
            .await
            .unwrap();
        let tasks = FixedTasks::default();
        let app = router(
            Arc::new(repo.clone()),
            configured_hosts(&["http://agent-harness-service:8102"]).unwrap(),
            InternalTools {
                service: Arc::new(SessionPullRequestService::new(
                    repo.clone(),
                    RecordingRealtime::new(),
                    Arc::new(tasks.clone()),
                )),
                tasks: Arc::new(tasks),
                code_mode: Some(Arc::new(OwnerRollout {
                    js_tools,
                    languages: Default::default(),
                })),
                cognition: None,
                reviews: Arc::new(OnceLock::new()),
                gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
                app_url: "https://macro.com".into(),
                permissions: Some(Arc::new(Unrestricted)),
            },
        );
        let offered = js_tools;
        let (_, listed) = rpc(
            app.clone(),
            Some("secret"),
            "tools/list",
            serde_json::json!({}),
        )
        .await;
        let show = listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "ShowPermissions")
            .cloned();
        assert_eq!(show.is_some(), offered, "{listed}");
        if let Some(show) = show {
            assert_eq!(show["annotations"]["readOnlyHint"], true);
            // It spends nobody's access, so it takes no acting_as.
            assert!(show["inputSchema"]["properties"].get("acting_as").is_none());
        }
        let (_, called) = rpc(
            app.clone(),
            Some("secret"),
            "tools/call",
            serde_json::json!({
                "name": "ShowPermissions",
                "arguments": {"groups": [{"group": "email", "actions": ["send"]}]},
            }),
        )
        .await;
        if offered {
            let result = &called["result"];
            assert_ne!(result["isError"], true, "{called}");
            let content = &result["structuredContent"];
            assert_eq!(content["sessionId"], session.id.to_string(), "{called}");
            assert_eq!(content["current"][0]["state"], "always");
            let (_, refused) = rpc(
                app,
                Some("secret"),
                "tools/call",
                serde_json::json!({
                    "name": "ShowPermissions",
                    "arguments": {"groups": [{"group": "spaceships"}]},
                }),
            )
            .await;
            assert_eq!(refused["result"]["isError"], true, "{refused}");
        } else {
            assert_eq!(called["result"]["isError"], true, "{called}");
        }
    }
}
