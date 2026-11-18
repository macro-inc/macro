use std::time::Duration;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ContentBlock, ErrorData, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerConfig,
};
use rmcp::service::{RequestContext as McpRequestContext, RoleServer};
use rmcp::{ServerHandler, ServiceExt as _};
use tokio::sync::Notify;

use super::*;

/// `hold` waits until its request is cancelled, as a call held for the
/// owner's approval does; `echo` answers at once.
#[derive(Clone, Default)]
struct HoldingServer {
    holding: Arc<Notify>,
    cancelled: Arc<Notify>,
}

impl ServerHandler for HoldingServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: McpRequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(vec![
            Tool::new(
                "hold",
                "Waits for the owner's approval.",
                Arc::new(serde_json::Map::new()),
            ),
            Tool::new("echo", "Answers at once.", Arc::new(serde_json::Map::new())),
        ]))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: McpRequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if request.name == "echo" {
            return Ok(CallToolResult::success(vec![ContentBlock::text("echo")]).into());
        }
        self.holding.notify_one();
        context.ct.cancelled().await;
        self.cancelled.notify_one();
        Err(ErrorData::internal_error("cancelled", None))
    }
}

#[tokio::test]
async fn cancelling_the_request_abandons_a_held_call_and_tells_the_server() {
    let server = HoldingServer::default();
    let (server_side, client_side) = tokio::io::duplex(8192);
    tokio::spawn({
        let server = server.clone();
        async move {
            let running = server.serve(server_side).await.unwrap();
            let _ = running.waiting().await;
        }
    });
    let client = crate::client_info().serve(client_side).await.unwrap();
    let tools = RemoteMcpToolSet::from_connected(
        vec![ConnectedServer {
            name: "Macro".into(),
            client,
        }],
        None,
    )
    .await;
    let request = RequestContext::new(
        macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
    );
    let cancel = request.cancel.clone();
    let call = tokio::spawn({
        let tools = tools.clone();
        async move {
            ToolSet::<()>::dispatch_tool_call(
                &tools,
                (),
                request,
                "mcp__Macro__hold",
                &serde_json::json!({}),
            )
            .await
        }
    });
    server.holding.notified().await;

    cancel.cancel();
    let result = tokio::time::timeout(Duration::from_secs(5), call)
        .await
        .expect("cancelling the request ends the held call")
        .unwrap()
        .unwrap();

    assert_eq!(
        result.unwrap_err().description,
        "Stopped before the tool replied; the server may still have completed it."
    );
    tokio::time::timeout(Duration::from_secs(5), server.cancelled.notified())
        .await
        .expect("the server is told the call was cancelled");

    let echo = ToolSet::<()>::dispatch_tool_call(
        &tools,
        (),
        RequestContext::new(
            macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
        ),
        "mcp__Macro__echo",
        &serde_json::json!({}),
    )
    .await
    .unwrap();
    assert!(echo.is_ok(), "the session still serves calls: {echo:?}");
}

/// Opens a session on a [`HoldingServer`], whose tools are `hold` and `echo`.
async fn holding_session() -> Arc<McpServer> {
    let (server_side, client_side) = tokio::io::duplex(8192);
    tokio::spawn(async move {
        let running = HoldingServer::default().serve(server_side).await.unwrap();
        let _ = running.waiting().await;
    });
    Arc::new(crate::client_info().serve(client_side).await.unwrap())
}

/// A tool's server is the one it was registered under, whatever its mangled
/// name's server segment says: a server named to mangle like another
/// (`macro_internal_` like `macro_internal`) is still told apart, in either
/// order.
#[tokio::test]
async fn a_tools_server_is_the_one_it_was_registered_under() {
    let listed = |name: &str, client: Arc<McpServer>, tool: &str| ListedServer {
        name: name.to_owned(),
        client,
        tools: vec![Tool::new(
            tool.to_owned(),
            "",
            Arc::new(serde_json::Map::new()),
        )],
        trace_context: TraceContext::Withhold,
    };
    let impostor_first = RemoteMcpToolSet::from_listed(
        vec![
            listed("macro__internal", holding_session().await, "post"),
            listed("macro_internal_", holding_session().await, "echo"),
            listed("macro_internal", holding_session().await, "echo"),
            listed("macro_internal", holding_session().await, "send"),
        ],
        None,
    );
    assert_eq!(
        impostor_first.server_of("mcp__macro_internal__post"),
        Some("macro__internal")
    );
    assert_eq!(
        impostor_first.server_of("mcp__macro_internal__echo"),
        Some("macro_internal_")
    );
    assert_eq!(
        impostor_first.server_of("mcp__macro_internal__send"),
        Some("macro_internal")
    );
    assert_eq!(
        impostor_first.server_of("mcp__macro_internal__missing"),
        None
    );

    let internal_first = RemoteMcpToolSet::from_listed(
        vec![
            listed("macro_internal", holding_session().await, "echo"),
            listed("macro_internal_", holding_session().await, "echo"),
        ],
        None,
    );
    assert_eq!(
        internal_first.server_of("mcp__macro_internal__echo"),
        Some("macro_internal")
    );
}

/// Answers `echo` and keeps each call's `traceparent`.
#[derive(Clone, Default)]
struct TraceRecordingServer {
    traceparents: Arc<std::sync::Mutex<Vec<Option<String>>>>,
}

impl ServerHandler for TraceRecordingServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }

    async fn call_tool(
        &self,
        _request: CallToolRequestParams,
        context: McpRequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        self.traceparents
            .lock()
            .unwrap()
            .push(context.meta.get_traceparent().map(str::to_owned));
        Ok(CallToolResult::success(vec![ContentBlock::text("echo")]).into())
    }
}

/// Our own server gets the caller's trace context in `_meta`; anyone else's
/// gets none.
#[tokio::test]
async fn only_servers_we_run_are_sent_the_callers_trace_context() {
    use opentelemetry::trace::{TraceContextExt as _, TracerProvider as _};
    use tracing::Instrument as _;
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    // Global: other tests reach `call_tool`'s span callsite with no
    // subscriber of their own, and a thread-local one can lose that race.
    tracing::subscriber::set_global_default(subscriber)
        .expect("no other test in this binary installs a global subscriber");

    let session = |server: TraceRecordingServer| async move {
        let (server_side, client_side) = tokio::io::duplex(8192);
        tokio::spawn(async move {
            let running = server.serve(server_side).await.unwrap();
            let _ = running.waiting().await;
        });
        Arc::new(crate::client_info().serve(client_side).await.unwrap())
    };
    let ours = TraceRecordingServer::default();
    let theirs = TraceRecordingServer::default();
    let echo = || vec![Tool::new("echo", "", Arc::new(serde_json::Map::new()))];
    let tools = RemoteMcpToolSet::from_listed(
        vec![
            ListedServer {
                name: "macro_internal".into(),
                client: session(ours.clone()).await,
                tools: echo(),
                trace_context: TraceContext::Propagate,
            },
            ListedServer {
                name: "Linear".into(),
                client: session(theirs.clone()).await,
                tools: echo(),
                trace_context: TraceContext::Withhold,
            },
        ],
        None,
    );
    let turn = tracing::info_span!("turn");
    let trace_id = turn.context().span().span_context().trace_id();
    for name in ["mcp__macro_internal__echo", "mcp__Linear__echo"] {
        ToolSet::<()>::dispatch_tool_call(
            &tools,
            (),
            RequestContext::new(
                macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com")
                    .unwrap(),
            ),
            name,
            &serde_json::json!({}),
        )
        .instrument(turn.clone())
        .await
        .unwrap()
        .unwrap();
    }

    let ours = ours.traceparents.lock().unwrap().clone();
    let [Some(traceparent)] = ours.as_slice() else {
        panic!("our server is sent the caller's context: {ours:?}");
    };
    assert!(
        traceparent.contains(&trace_id.to_string()),
        "{traceparent} is in trace {trace_id}"
    );
    assert_eq!(*theirs.traceparents.lock().unwrap(), vec![None]);
}
