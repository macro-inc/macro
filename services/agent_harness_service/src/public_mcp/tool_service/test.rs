use super::*;
use ai_toolset::AsyncToolCollection;
use bot_id::BotId;
use rmcp::{handler::server::ServerHandler, model::ErrorCode};

fn empty_service() -> AuthenticatedToolService<()> {
    AuthenticatedToolService::new(
        Arc::new(AsyncToolCollection::new()),
        (),
        "https://macro.com".to_owned(),
        url::Url::parse("https://static-file-service.macro.com").unwrap(),
        McpAnalytics::disabled(),
    )
}

#[tokio::test]
async fn server_info_advertises_macro_tools() {
    let info = empty_service().get_info();

    assert_eq!(info.server_info.name, "macro-tools");
    assert_eq!(info.server_info.title.as_deref(), Some("Macro"));
    assert_eq!(info.server_info.version, env!("CARGO_PKG_VERSION"));
    assert!(
        info.server_info
            .description
            .as_deref()
            .is_some_and(|description| description.contains("documents, emails, and messages"))
    );
    assert!(info.capabilities.tools.is_some());
}

#[tokio::test]
async fn server_info_advertises_the_web_app_favicon() {
    let info = empty_service().get_info();

    let icons = info
        .server_info
        .icons
        .expect("server should advertise an icon");
    let [icon] = icons.as_slice() else {
        panic!("server should advertise exactly one icon");
    };

    // The same file the web app's <link rel="icon"> points at.
    assert_eq!(icon.src, "https://macro.com/app/macro-favicon.svg");
    assert_eq!(icon.mime_type.as_deref(), Some("image/svg+xml"));
    assert_eq!(icon.sizes.as_deref(), Some(["any".to_owned()].as_slice()));
}

#[tokio::test]
async fn server_instructions_describe_available_workflows() {
    let instructions = empty_service()
        .get_info()
        .instructions
        .expect("server should provide MCP instructions");

    for expected_text in [
        "Macro workspace",
        "ContentSearch",
        "NameSearch",
        "ReadContent",
        "ReadMetadata",
        "ReadAgentSession",
        "ReadChannelMessages",
        "ReadChannelThread",
        "ReadChannelMessageContext",
        "downloadable URLs",
        "CreateDocument",
        "ListEntities",
        "ListSkills",
        "ReadSkill",
    ] {
        assert!(
            instructions.contains(expected_text),
            "instructions should mention {expected_text}"
        );
    }
}

#[tokio::test]
async fn server_instructions_link_items_as_urls_not_mention_tags() {
    let instructions = empty_service()
        .get_info()
        .instructions
        .expect("server should provide MCP instructions");

    // MCP responses must link items with plain URLs built from the app base URL.
    assert!(
        instructions.contains("https://macro.com/app/"),
        "instructions should build item links from the app base url"
    );
    // And must steer the model away from the in-app mention markup.
    assert!(
        instructions.contains("<m-document-mention>"),
        "instructions should reference the mention tag it is forbidding"
    );
    assert!(
        instructions.contains("Do NOT emit"),
        "instructions should forbid emitting mention tags in MCP responses"
    );
    // Lists of items should be rendered as a table with number/name/link columns.
    for column in ["number", "name", "link"] {
        assert!(
            instructions.contains(column),
            "instructions should describe the {column} table column"
        );
    }
}

#[tokio::test]
async fn empty_toolset_lists_no_tools() {
    assert!(empty_service().tool_definitions().is_empty());
}

/// Anthropic's connector directory rejects any tool missing a display title or
/// the applicable `readOnlyHint`/`destructiveHint`, and any tool name over 64
/// characters. Assert it against the toolset the server actually exposes, so a
/// newly added tool can't quietly regress the submission.
#[test]
fn every_exposed_tool_meets_directory_requirements() {
    let tools = ai_tools::tools_for(ai_tools::AiHost::Mcp);
    assert!(
        !tools.toolset.tools.is_empty(),
        "the MCP toolset should not be empty"
    );

    for (name, tool) in tools.toolset.tools.iter() {
        let annotations = mcp_annotations(&tool.annotations);

        assert!(
            name.len() <= 64,
            "{name} exceeds the 64-character tool name limit"
        );
        assert!(
            annotations
                .title
                .as_deref()
                .is_some_and(|title| !title.trim().is_empty()),
            "{name} has no display title"
        );
        assert!(
            annotations.read_only_hint.is_some(),
            "{name} has no readOnlyHint"
        );
        assert!(
            annotations.destructive_hint.is_some(),
            "{name} has no destructiveHint"
        );
        assert!(
            !(annotations.read_only_hint == Some(true)
                && annotations.destructive_hint == Some(true)),
            "{name} claims to be both read-only and destructive"
        );
    }
}

#[test]
fn read_only_tools_map_to_read_only_hint() {
    let annotations = mcp_annotations(&ai_toolset::ToolAnnotations::read_only("Read document"));

    assert_eq!(annotations.title.as_deref(), Some("Read document"));
    assert_eq!(annotations.read_only_hint, Some(true));
    assert_eq!(annotations.destructive_hint, Some(false));
    assert_eq!(annotations.idempotent_hint, Some(true));
    assert_eq!(annotations.open_world_hint, Some(false));
}

#[test]
fn destructive_tools_map_to_destructive_hint() {
    let annotations =
        mcp_annotations(&ai_toolset::ToolAnnotations::destructive("Send email").with_open_world());

    assert_eq!(annotations.title.as_deref(), Some("Send email"));
    assert_eq!(annotations.read_only_hint, Some(false));
    assert_eq!(annotations.destructive_hint, Some(true));
    assert_eq!(annotations.open_world_hint, Some(true));
}

#[test]
fn additive_tools_set_neither_hint() {
    let annotations = mcp_annotations(&ai_toolset::ToolAnnotations::additive("Create document"));

    assert_eq!(annotations.read_only_hint, Some(false));
    assert_eq!(annotations.destructive_hint, Some(false));
}

#[test]
fn authenticated_user_id_is_read_from_http_request_parts() {
    let expected_user_id = MacroUserIdStr::try_from_email("User@macro.com").unwrap();
    let mut parts = http::Request::new(()).into_parts().0;
    parts.extensions.insert(expected_user_id.clone());

    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);

    let user_id = AuthenticatedToolService::<()>::authenticated_user_id(&extensions).unwrap();

    assert_eq!(user_id, expected_user_id);
}

#[test]
fn authenticated_user_id_requires_request_parts() {
    let error =
        AuthenticatedToolService::<()>::authenticated_user_id(&rmcp::model::Extensions::new())
            .expect_err("missing request parts should fail auth extraction");

    assert_eq!(error.code, ErrorCode::INTERNAL_ERROR);
    assert_eq!(error.message, "missing user identity — is auth configured?");
}

#[test]
fn authenticated_user_id_requires_user_extension_inside_request_parts() {
    let parts = http::Request::new(()).into_parts().0;
    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);

    let error = AuthenticatedToolService::<()>::authenticated_user_id(&extensions)
        .expect_err("missing user id should fail auth extraction");

    assert_eq!(error.code, ErrorCode::INTERNAL_ERROR);
    assert_eq!(error.message, "missing user identity — is auth configured?");
}

fn call_extensions(
    caller: Option<ToolCaller>,
    headers: &[(&str, &str)],
) -> rmcp::model::Extensions {
    let mut request = http::Request::new(());
    for (name, value) in headers {
        request.headers_mut().insert(
            http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            http::HeaderValue::from_str(value).unwrap(),
        );
    }
    let mut parts = request.into_parts().0;
    if let Some(caller) = caller {
        parts.extensions.insert(caller);
    }
    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);
    extensions
}

/// The caller is whatever the bearer middleware authenticated; a bot the
/// request names for itself never replaces it.
#[test]
fn the_caller_is_the_authenticated_one_not_one_the_request_names() {
    let forged = BotId::TEST_A.to_string();

    assert_eq!(
        caller(&call_extensions(
            Some(ToolCaller::ApiKey),
            &[("x-macro-agent-id", &forged), ("x-macro-bot-id", &forged)],
        ))
        .unwrap(),
        ToolCaller::ApiKey
    );
}

/// With no authenticated caller there is nothing to write as, so the call
/// fails instead of falling back to the Macro bot.
#[test]
fn a_call_without_a_caller_is_refused() {
    let error = caller(&call_extensions(None, &[])).expect_err("no caller");

    assert_eq!(error.code, ErrorCode::INTERNAL_ERROR);
}

mod code_mode {
    use super::*;
    use agent_code_mode::domain::{
        CodeModeError, ExecutionStatus, UserCodeMode, UserExecutionReceipt,
    };
    use agent_inmem::domain::tool_mode::ToolModeSelector;
    use ai_toolset::{ToolAnnotated, ToolAnnotations};
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use code_execution::domain::ExecuteRequest;
    use rmcp::transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    };
    use serde::Deserialize;
    use std::{future::Future, pin::Pin, sync::Mutex};
    use tokio_util::sync::CancellationToken;
    use tower::ServiceExt;

    const FLAGGED: &str = "flagged@example.com";
    const UNFLAGGED: &str = "unflagged@example.com";

    /// Code mode only for [`FLAGGED`].
    struct Flag;
    impl ToolModeSelector for Flag {
        fn select<'a>(
            &'a self,
            owner: &'a MacroUserIdStr<'_>,
        ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
            let mode = if owner.as_ref() == format!("macro|{FLAGGED}") {
                ToolMode::Code
            } else {
                ToolMode::Standard
            };
            Box::pin(async move { mode })
        }
    }

    /// Records who ran what, as which agent, and returns the source length as data.
    #[derive(Default)]
    struct Runs(Mutex<Vec<(String, String)>>, Mutex<Vec<ToolCaller>>);
    #[async_trait::async_trait]
    impl UserCodeMode for Runs {
        async fn execute(
            &self,
            user: &MacroUserIdStr<'static>,
            caller: &ToolCaller,
            request: ExecuteRequest,
            _: CancellationToken,
        ) -> Result<UserExecutionReceipt, CodeModeError> {
            self.1.lock().unwrap().push(caller.clone());
            self.0
                .lock()
                .unwrap()
                .push((user.to_string(), request.source.clone()));
            Ok(UserExecutionReceipt {
                status: ExecutionStatus::Succeeded,
                activity: vec![],
                activity_truncated: false,
                result: Some(serde_json::json!({"data": request.source.len()})),
                error: None,
            })
        }
    }

    /// Direct tools that used to leak next to code mode on `tools/list`.
    #[derive(Deserialize, schemars::JsonSchema)]
    #[schemars(title = "NameSearch", description = "Search by name.")]
    struct NameSearch {}
    impl ToolAnnotated for NameSearch {
        const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Search by name");
    }
    #[async_trait::async_trait]
    impl ai_toolset::AsyncTool<()> for NameSearch {
        type Output = serde_json::Value;
        async fn call(
            &self,
            _: ai_toolset::ServiceContext<()>,
            _: ai_toolset::RequestContext,
        ) -> ai_toolset::ToolResult<Self::Output> {
            Ok(serde_json::json!({"ok": true}))
        }
    }

    #[derive(Deserialize, schemars::JsonSchema)]
    #[schemars(title = "ReadContent", description = "Read a document.")]
    struct ReadContent {}
    impl ToolAnnotated for ReadContent {
        const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read document");
    }
    #[async_trait::async_trait]
    impl ai_toolset::AsyncTool<()> for ReadContent {
        type Output = serde_json::Value;
        async fn call(
            &self,
            _: ai_toolset::ServiceContext<()>,
            _: ai_toolset::RequestContext,
        ) -> ai_toolset::ToolResult<Self::Output> {
            Ok(serde_json::json!({"ok": true}))
        }
    }

    #[derive(Deserialize, schemars::JsonSchema)]
    #[schemars(title = "EditDocument", description = "Edit a document.")]
    struct EditDocument {}
    impl ToolAnnotated for EditDocument {
        const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Edit document");
    }
    #[async_trait::async_trait]
    impl ai_toolset::AsyncTool<()> for EditDocument {
        type Output = serde_json::Value;
        async fn call(
            &self,
            _: ai_toolset::ServiceContext<()>,
            _: ai_toolset::RequestContext,
        ) -> ai_toolset::ToolResult<Self::Output> {
            Ok(serde_json::json!({"ok": true}))
        }
    }

    #[derive(Deserialize, schemars::JsonSchema)]
    #[schemars(title = "ListCalendarEvents", description = "List calendar events.")]
    struct ListCalendarEvents {}
    impl ToolAnnotated for ListCalendarEvents {
        const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List calendar events");
    }
    #[async_trait::async_trait]
    impl ai_toolset::AsyncTool<()> for ListCalendarEvents {
        type Output = serde_json::Value;
        async fn call(
            &self,
            _: ai_toolset::ServiceContext<()>,
            _: ai_toolset::RequestContext,
        ) -> ai_toolset::ToolResult<Self::Output> {
            Ok(serde_json::json!({"ok": true}))
        }
    }

    const DIRECT_TOOLS: [&str; 4] = [
        "EditDocument",
        "ListCalendarEvents",
        "NameSearch",
        "ReadContent",
    ];

    fn catalog() -> Arc<AsyncToolCollection<()>> {
        Arc::new(
            AsyncToolCollection::new()
                .add_tool::<NameSearch, ()>()
                .add_tool::<ReadContent, ()>()
                .add_tool::<EditDocument, ()>()
                .add_tool::<ListCalendarEvents, ()>(),
        )
    }

    fn catalog_service() -> AuthenticatedToolService<()> {
        AuthenticatedToolService::new(
            catalog(),
            (),
            "https://macro.com".to_owned(),
            url::Url::parse("https://static-file-service.macro.com").unwrap(),
            McpAnalytics::disabled(),
        )
    }

    fn app(runs: Arc<dyn UserCodeMode>) -> axum::Router {
        let surface = Arc::new(CodeModeSurface {
            tools: Arc::new(agent_code_mode::inbound::toolset::user_toolset()),
            service: runs,
            cognition: None,
            selector: Arc::new(Flag),
        });
        let mut config =
            StreamableHttpServerConfig::default().with_allowed_hosts(["localhost".to_owned()]);
        config.stateful_mode = false;
        config.json_response = true;
        let service = StreamableHttpService::new(
            move || Ok(catalog_service().with_code_mode(surface.clone())),
            Arc::new(LocalSessionManager::default()),
            config,
        );
        // Stands in for the bearer middleware's user id; each request carries
        // its caller as the middleware would leave it.
        axum::Router::new()
            .nest_service("/mcp", service)
            .layer(axum::middleware::from_fn(
                |mut request: axum::extract::Request, next: axum::middleware::Next| async move {
                    let user = request.headers()["x-user"].to_str().unwrap().to_owned();
                    request
                        .extensions_mut()
                        .insert(MacroUserIdStr::try_from_email(&user).unwrap());
                    next.run(request).await
                },
            ))
    }

    async fn rpc(
        app: axum::Router,
        user: &str,
        method: &str,
        params: serde_json::Value,
    ) -> serde_json::Value {
        rpc_as(app, user, Some(ToolCaller::ApiKey), method, params).await
    }

    /// An RPC the bearer middleware authenticated as `caller`.
    async fn rpc_as(
        app: axum::Router,
        user: &str,
        caller: Option<ToolCaller>,
        method: &str,
        params: serde_json::Value,
    ) -> serde_json::Value {
        let mut request = Request::builder();
        if let Some(caller) = caller {
            request = request.extension(caller);
        }
        let response = app
            .oneshot(
                request
                    .method("POST")
                    .uri("/mcp")
                    .header("host", "localhost")
                    .header("x-user", user)
                    .header("content-type", "application/json")
                    .header("accept", "application/json, text/event-stream")
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
        let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn tool_names(response: &serde_json::Value) -> Vec<String> {
        let mut names: Vec<String> = response["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_owned())
            .collect();
        names.sort();
        names
    }

    #[tokio::test]
    async fn only_flagged_users_see_code_mode_tools_and_instructions() {
        let app = app(Arc::new(Runs::default()));

        let flagged = rpc(app.clone(), FLAGGED, "tools/list", serde_json::json!({})).await;
        assert_eq!(
            tool_names(&flagged),
            ["DescribeCodeTools", "ExecuteCode", "ReadCodeDocs"]
        );
        for leaked in DIRECT_TOOLS {
            assert!(
                !tool_names(&flagged).iter().any(|name| name == leaked),
                "{leaked} must not appear on the code-mode catalog"
            );
        }
        let unflagged = rpc(app.clone(), UNFLAGGED, "tools/list", serde_json::json!({})).await;
        assert_eq!(tool_names(&unflagged), DIRECT_TOOLS);
        assert!(
            !tool_names(&unflagged)
                .iter()
                .any(|name| name == "ExecuteCode")
        );

        let initialize = serde_json::json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        });
        let flagged = rpc(app.clone(), FLAGGED, "initialize", initialize.clone()).await;
        let flagged_instructions = flagged["result"]["instructions"].as_str().unwrap();
        assert!(flagged_instructions.contains("Code mode is on"));
        assert!(flagged_instructions.contains("ExecuteCode"));
        assert!(flagged_instructions.contains("DescribeCodeTools"));
        for leaked in [
            "NameSearch",
            "ReadContent",
            "ContentSearch",
            "Direct tools remain",
        ] {
            assert!(
                !flagged_instructions.contains(leaked),
                "code-mode initialize must not advertise {leaked}"
            );
        }
        let unflagged = rpc(app, UNFLAGGED, "initialize", initialize).await;
        let unflagged_instructions = unflagged["result"]["instructions"].as_str().unwrap();
        assert!(!unflagged_instructions.contains("Code mode is on"));
        assert!(unflagged_instructions.contains("ContentSearch"));
        assert!(unflagged_instructions.contains("NameSearch"));
    }

    #[tokio::test]
    async fn execute_code_runs_as_the_caller_only_when_flagged() {
        let runs = Arc::new(Runs::default());
        let app = app(runs.clone());
        let call = serde_json::json!({
            "name": "ExecuteCode",
            "arguments": {"source": "export async function main() { return {data: 1}; }"},
        });

        let unflagged = rpc(app.clone(), UNFLAGGED, "tools/call", call.clone()).await;
        assert!(unflagged.get("error").is_some());
        assert!(runs.0.lock().unwrap().is_empty());

        let flagged = rpc(app.clone(), FLAGGED, "tools/call", call).await;
        assert_eq!(
            flagged["result"]["structuredContent"]["status"],
            "succeeded"
        );
        assert_eq!(
            *runs.0.lock().unwrap(),
            [(
                format!("macro|{FLAGGED}"),
                "export async function main() { return {data: 1}; }".to_owned()
            )]
        );
    }

    /// `ExecuteCode` runs for exactly the caller the middleware
    /// authenticated, one per kind, so its credential can be minted for it.
    #[tokio::test]
    async fn execute_code_runs_for_each_kind_of_caller() {
        let runs = Arc::new(Runs::default());
        let app = app(runs.clone());
        let call = serde_json::json!({
            "name": "ExecuteCode",
            "arguments": {"source": "export async function main() { return {data: 1}; }"},
        });
        let callers = [
            ToolCaller::Agent(BotId::TEST_A),
            ToolCaller::McpClient {
                name: Some("Claude Code".to_owned()),
            },
            ToolCaller::ApiKey,
        ];

        for caller in callers.clone() {
            rpc_as(
                app.clone(),
                FLAGGED,
                Some(caller),
                "tools/call",
                call.clone(),
            )
            .await;
        }

        assert_eq!(*runs.1.lock().unwrap(), callers);
    }

    /// A request the middleware left without a caller runs nothing.
    #[tokio::test]
    async fn execute_code_without_a_caller_runs_nothing() {
        let runs = Arc::new(Runs::default());
        let app = app(runs.clone());
        let call = serde_json::json!({
            "name": "ExecuteCode",
            "arguments": {"source": "export async function main() { return {data: 1}; }"},
        });

        let response = rpc_as(app, FLAGGED, None, "tools/call", call).await;

        assert!(response.get("error").is_some());
        assert!(runs.1.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn hidden_native_tools_remain_callable_in_code_mode() {
        let app = app(Arc::new(Runs::default()));
        let result = rpc(
            app,
            FLAGGED,
            "tools/call",
            serde_json::json!({"name": "NameSearch", "arguments": {}}),
        )
        .await;
        assert_eq!(
            result["result"]["structuredContent"],
            serde_json::json!({"ok": true})
        );
    }

    #[test]
    fn code_mode_tools_meet_directory_requirements() {
        for (name, tool) in agent_code_mode::inbound::toolset::user_toolset()
            .tools
            .iter()
        {
            let annotations = mcp_annotations(&tool.annotations);
            assert!(annotations.title.is_some(), "{name} has no display title");
            assert!(annotations.read_only_hint.is_some(), "{name}");
            assert!(annotations.destructive_hint.is_some(), "{name}");
        }
    }

    struct NoCredentials;
    #[async_trait::async_trait]
    impl agent_code_mode::domain::UserExecutionCredentials for NoCredentials {
        async fn issue(
            &self,
            _: &MacroUserIdStr<'static>,
            _: &ToolCaller,
        ) -> Result<code_execution::domain::RunEnvironment, CodeModeError> {
            Ok(code_execution::domain::RunEnvironment::default())
        }
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn flagged_user_runs_real_javascript_over_mcp() {
        let scratch = tempfile::tempdir().unwrap();
        let path = tokio::process::Command::new("which")
            .arg("deno")
            .output()
            .await
            .unwrap();
        assert!(path.status.success(), "Deno 2.9.6 must be on PATH");
        let deno = code_execution::outbound::deno::DenoRunner::new(
            String::from_utf8(path.stdout).unwrap().trim().into(),
            scratch.path().to_owned(),
            128,
        )
        .await
        .unwrap();
        let runner = code_execution::domain::ExecutionService::new(
            Arc::new(deno),
            code_execution::domain::Limits::default(),
        )
        .unwrap();
        let app = app(Arc::new(agent_code_mode::domain::UserCodeModeService::new(
            Arc::new(runner),
            Arc::new(NoCredentials),
        )));

        let succeeded = rpc(
            app.clone(),
            FLAGGED,
            "tools/call",
            serde_json::json!({
                "name": "ExecuteCode",
                "arguments": {"source": "export async function main({macro, session}) { return {data: {sdk: typeof macro.documents, session: session ?? null, sum: [1, 2, 3].reduce((a, b) => a + b)}}; }"},
            }),
        )
        .await;
        let receipt = &succeeded["result"]["structuredContent"];
        assert_eq!(receipt["status"], "succeeded", "{succeeded}");
        assert_eq!(
            receipt["result"],
            serde_json::json!({"data": {"sdk": "object", "session": null, "sum": 6}})
        );

        let failed = rpc(
            app,
            FLAGGED,
            "tools/call",
            serde_json::json!({
                "name": "ExecuteCode",
                "arguments": {"source": "export async function main({macro}) { return {data: await macro.noSuchEntity.list()}; }"},
            }),
        )
        .await;
        let receipt = &failed["result"]["structuredContent"];
        assert_eq!(receipt["status"], "failed", "{failed}");
        assert!(
            receipt["error"].as_str().unwrap().contains("TypeError"),
            "{failed}"
        );
    }
}
