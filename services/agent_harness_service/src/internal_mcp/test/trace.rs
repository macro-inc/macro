use super::*;
use agent_code_mode::domain::{
    CodeModeError, ExecutionId, ExecutionReceipt, ExecutionRecord, SessionCodeMode,
};
use agent_session::domain::model::AgentSession;
use async_trait::async_trait;
use code_execution::domain::ExecuteRequest;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use opentelemetry::trace::{SpanContext, TraceContextExt as _, TracerProvider as _};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

/// Keeps the span context each execution starts under, then refuses to run.
#[derive(Clone, Default)]
struct SpanRecordingCodeMode {
    started_under: Arc<std::sync::Mutex<Vec<SpanContext>>>,
}

#[async_trait]
impl SessionCodeMode for SpanRecordingCodeMode {
    async fn execute(
        &self,
        _: &AgentSession,
        _: ExecutionId,
        _: ai_toolset::actor::ToolActor,
        _: macro_uuid::Uuid,
        _: ExecuteRequest,
        _: tokio_util::sync::CancellationToken,
    ) -> Result<ExecutionReceipt, CodeModeError> {
        let context = tracing::Span::current().context();
        self.started_under
            .lock()
            .unwrap()
            .push(context.span().span_context().clone());
        Err(CodeModeError::Unavailable)
    }

    async fn read(
        &self,
        _: &EntityAccessReceipt<ViewAccessLevel>,
        _: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        Err(CodeModeError::NotFound)
    }
}

struct NoAppEgress;

impl agent_egress::domain::service::EgressService for NoAppEgress {
    async fn proxy(
        &self,
        _: &SessionToken,
        _: agent_egress::domain::model::EgressTarget,
        _: agent_egress::domain::model::ProxyRequest,
    ) -> Result<agent_egress::domain::model::ProxyResponse, agent_egress::domain::error::EgressError>
    {
        panic!("internal tools must not be routed to a third-party app");
    }
}

/// A call marked withheld in its `_meta` gets its misfit arguments back
/// without their value, through the handler that reads the mark; an
/// unmarked call keeps serde's message.
#[tokio::test]
async fn a_marked_calls_misfit_arguments_come_back_without_their_value() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
        .await
        .unwrap();
    let tasks = FixedTasks::default();
    let app = router(
        Arc::new(repo.clone()),
        Vec::new(),
        InternalTools {
            service: Arc::new(SessionPullRequestService::new(
                repo.clone(),
                RecordingRealtime::new(),
                Arc::new(tasks.clone()),
            )),
            tasks: Arc::new(tasks),
            code_mode: Some(Arc::new(SpanRecordingCodeMode::default())),
            cognition: None,
            reviews: Arc::new(OnceLock::new()),
            gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
            app_url: "https://macro.com".into(),
        },
    );
    for marked in [false, true] {
        let mut params = serde_json::json!({
            "name": "ExecuteCode",
            "arguments": {
                "turn_id": "00000000-0000-0000-0000-000000000003",
                "source": "export async function main() { return {data: 1}; }",
                "timeout_ms": "the private supplier list",
            },
        });
        if marked {
            params["_meta"] = serde_json::json!({ "macro.dev/withhold-content": true });
        }
        let (_, response) = rpc(app.clone(), Some("secret"), "tools/call", params).await;
        let message = response["error"]["message"]
            .as_str()
            .unwrap_or_else(|| panic!("the call is refused: {response}"));
        assert_eq!(message.contains("private supplier"), !marked, "{message}");
        if marked {
            assert!(message.contains("invalid type, expected u64"), "{message}");
        }
    }
}

/// The in-process agent's ExecuteCode reaches the internal MCP server with
/// the turn's trace context, so the execution (and the sandbox and SDK spans
/// under it) joins the session's trace instead of starting its own.
#[tokio::test]
async fn an_execution_joins_the_trace_of_the_turn_that_called_it() {
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let exporter = opentelemetry_sdk::trace::InMemorySpanExporter::default();
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    // Global, not thread-local: tests running alongside reach the same
    // server span callsites with no subscriber of their own, and a
    // thread-local default loses that race and sees them disabled. Their
    // spans may land in this exporter too; the links below are followed by id.
    tracing::subscriber::set_global_default(subscriber)
        .expect("no other test in this binary installs a global subscriber");

    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    repo.set_egress_token_hash(session.id, &SessionToken::new("secret").hash())
        .await
        .unwrap();
    let tasks = FixedTasks::default();
    let code_mode = SpanRecordingCodeMode::default();
    let app = router(
        Arc::new(repo.clone()),
        Vec::new(),
        InternalTools {
            service: Arc::new(SessionPullRequestService::new(
                repo.clone(),
                RecordingRealtime::new(),
                Arc::new(tasks.clone()),
            )),
            tasks: Arc::new(tasks),
            code_mode: Some(Arc::new(code_mode.clone())),
            cognition: None,
            reviews: Arc::new(OnceLock::new()),
            gate: Arc::new(agent_inmem::domain::tool_gate::UngatedNativeTools),
            app_url: "https://macro.com".into(),
        },
    );
    use agent_inmem::domain::mcp::McpToolConnector as _;
    let connector = agent_inmem::outbound::acp_mcp::AcpMcpConnector::new(
        agent_inmem::outbound::egress_mcp::EgressMcpClient::new(
            Arc::new(NoAppEgress),
            "http://localhost/agent-harness-egress",
        )
        .with_internal_mcp(crate::internal_mcp_handler(app)),
    );
    let tools = connector
        .connect(vec![
            agent_client_protocol::schema::v1::McpServerHttp::new(
                "macro_internal",
                "http://localhost/agent-harness-egress/mcp/internal",
            )
            .headers(vec![agent_client_protocol::schema::v1::HttpHeader::new(
                "Authorization",
                "Bearer secret",
            )]),
        ])
        .await
        .expect("the internal server connects");

    let turn = tracing::info_span!(parent: None, "agent.acp.prompt");
    let turn_context = turn.context().span().span_context().clone();
    ai_toolset::ToolSet::<()>::dispatch_tool_call(
        &tools,
        (),
        RequestContext::new(session.owner_user().unwrap().clone()),
        "mcp__macro_internal__ExecuteCode",
        &serde_json::json!({
            "acting_as": "owner",
            "turn_id": "00000000-0000-0000-0000-000000000003",
            "source": "export async function main() { return {data: 1}; }",
        }),
    )
    .instrument(turn.clone())
    .await
    .unwrap()
    .unwrap_err();
    drop(turn);

    let started_under = code_mode.started_under.lock().unwrap().clone();
    let [execution_parent] = started_under.as_slice() else {
        panic!("one execution started: {started_under:?}");
    };
    provider.force_flush().unwrap();
    let spans = exporter.get_finished_spans().unwrap();
    assert_eq!(
        execution_parent.trace_id(),
        turn_context.trace_id(),
        "the execution is in the turn's trace: {:#?}",
        spans
            .iter()
            .map(|span| (
                span.name.to_string(),
                span.span_context.trace_id(),
                span.span_context.span_id(),
                span.parent_span_id
            ))
            .collect::<Vec<_>>()
    );

    // Unbroken parent links: execution → internal MCP call → the client's
    // tool call → the turn.
    let by_id = |id| spans.iter().find(|span| span.span_context.span_id() == id);
    let mut ancestor =
        by_id(execution_parent.span_id()).expect("the execution's parent span was exported");
    let mut chain = vec![ancestor.name.to_string()];
    while ancestor.parent_span_id != turn_context.span_id() {
        ancestor = by_id(ancestor.parent_span_id).unwrap_or_else(|| {
            panic!("broken parent link above {chain:?}");
        });
        chain.push(ancestor.name.to_string());
    }
    assert!(
        chain.ends_with(&["internal_mcp.call_tool".into(), "call_tool".into()]),
        "{chain:?}"
    );
}
