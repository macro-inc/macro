use super::*;
use ai_toolset::AsyncToolCollection;
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

mod code_mode {
    use super::*;
    use agent_code_mode::domain::{
        CodeModeError, ExecutionStatus, UserCodeMode, UserExecutionReceipt,
    };
    use agent_inmem::domain::tool_mode::{ToolMode, ToolModeSelector};
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use code_execution::domain::ExecuteRequest;
    use rmcp::transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    };
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

    /// Records who ran what and returns the source length as data.
    #[derive(Default)]
    struct Runs(Mutex<Vec<(String, String)>>);
    #[async_trait::async_trait]
    impl UserCodeMode for Runs {
        async fn execute(
            &self,
            user: &MacroUserIdStr<'static>,
            request: ExecuteRequest,
            _: CancellationToken,
        ) -> Result<UserExecutionReceipt, CodeModeError> {
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

    fn app(runs: Arc<dyn UserCodeMode>) -> axum::Router {
        let surface = Arc::new(CodeModeSurface {
            native: Arc::new(AsyncToolCollection::new()),
            tools: Arc::new(agent_code_mode::inbound::toolset::user_toolset()),
            context: agent_code_mode::inbound::toolset::UserCodeModeToolContext {
                service: runs,
                cognition: None,
            },
            selector: Arc::new(Flag),
        });
        let mut config =
            StreamableHttpServerConfig::default().with_allowed_hosts(["localhost".to_owned()]);
        config.stateful_mode = false;
        config.json_response = true;
        let service = StreamableHttpService::new(
            move || Ok(empty_service().with_code_mode(surface.clone())),
            Arc::new(LocalSessionManager::default()),
            config,
        );
        // Stands in for the OAuth bearer middleware, which inserts the user id.
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
        let response = app
            .oneshot(
                Request::builder()
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
        assert_eq!(tool_names(&flagged), ["DescribeCodeTools", "ExecuteCode"]);
        let unflagged = rpc(app.clone(), UNFLAGGED, "tools/list", serde_json::json!({})).await;
        assert!(tool_names(&unflagged).is_empty());

        let initialize = serde_json::json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        });
        let flagged = rpc(app.clone(), FLAGGED, "initialize", initialize.clone()).await;
        assert!(
            flagged["result"]["instructions"]
                .as_str()
                .unwrap()
                .contains("Code mode is on")
        );
        let unflagged = rpc(app, UNFLAGGED, "initialize", initialize).await;
        assert!(
            !unflagged["result"]["instructions"]
                .as_str()
                .unwrap()
                .contains("Code mode is on")
        );
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

        let flagged = rpc(app, FLAGGED, "tools/call", call).await;
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
