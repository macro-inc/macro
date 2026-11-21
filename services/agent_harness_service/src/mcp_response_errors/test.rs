use super::*;
use axum::body::Body;
use axum::http::Request;
use rmcp::model::{CallToolRequestParams, CallToolResponse};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use std::sync::{Arc, Mutex, PoisonError};
use tower::ServiceExt as _;
use tracing_subscriber::Layer as _;
use tracing_subscriber::layer::SubscriberExt as _;

/// A server whose one tool refuses with a message and data holding the
/// caller's words, and
/// logs the refusal as this process's servers do.
#[derive(Clone)]
struct Refusing;

impl rmcp::ServerHandler for Refusing {
    async fn call_tool(
        &self,
        _: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        Err(ErrorData::invalid_params(
            "invalid value: the caller's own words",
            Some(serde_json::json!({"query": "the caller's own words"})),
        ))
        .inspect_err(|error| log_error_response(McpMethod::CallTool, error))
    }
}

#[derive(Clone, Default)]
struct Lines(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Lines {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Where each warning came from: (target, file, line).
#[derive(Clone, Default)]
struct Callsites(Arc<Mutex<Vec<(String, String, u32)>>>);

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Callsites {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        let metadata = event.metadata();
        if *metadata.level() == tracing::Level::WARN {
            self.0.lock().unwrap_or_else(PoisonError::into_inner).push((
                metadata.target().to_owned(),
                metadata.file().unwrap_or_default().to_owned(),
                metadata.line().unwrap_or_default(),
            ));
        }
    }
}

#[test]
fn error_responses_are_logged_without_their_data_and_rmcps_own_log_is_the_dropped_one() {
    let ours = Lines::default();
    let callsites = Callsites::default();
    let writer = ours.clone();
    let subscriber = tracing_subscriber::registry().with(callsites.clone()).with(
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_writer(move || writer.clone())
            .with_filter(tracing_subscriber::filter::Targets::new().with_target(
                "agent_harness_service::mcp_response_errors",
                tracing::Level::WARN,
            )),
    );
    let mut config =
        StreamableHttpServerConfig::default().with_allowed_hosts(["localhost".to_owned()]);
    config.legacy_session_mode = false;
    config.json_response = true;
    let service = StreamableHttpService::new(
        || Ok(Refusing),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let app = axum::Router::new().nest_service("/mcp", service);
    // A current-thread runtime, so rmcp's handler tasks log to this subscriber.
    let response = tracing::subscriber::with_default(subscriber, || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let response = app
                    .oneshot(
                        Request::post("/mcp")
                            .header("host", "localhost")
                            .header("content-type", "application/json")
                            .header("accept", "application/json, text/event-stream")
                            .body(Body::from(
                                serde_json::json!({
                                    "jsonrpc": "2.0", "id": "the caller's own words, as an id", "method": "tools/call",
                                    "params": {"name": "anything", "arguments": {}},
                                })
                                .to_string(),
                            ))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap()
            })
    });
    let response = String::from_utf8_lossy(&response);
    // The caller still gets the data.
    assert!(
        response.contains(r#""data":{"query":"the caller's own words"}"#),
        "{response}"
    );

    let ours = String::from_utf8_lossy(&ours.0.lock().unwrap_or_else(PoisonError::into_inner))
        .into_owned();
    assert!(ours.contains("response error"), "{ours}");
    assert!(ours.contains("-32602"), "{ours}");
    assert!(ours.contains("call_tool"), "{ours}");
    assert!(!ours.contains("caller's own words"), "{ours}");

    // rmcp's own warning, which prints the data, is the statement the first
    // rule drops.
    let rule = DROPPED_RMCP_CALLSITES[0];
    let callsites = callsites
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    assert!(
        callsites
            .iter()
            .any(|(target, file, line)| target == rule.target
                && file.ends_with(rule.file)
                && *line == rule.line),
        "{callsites:?}"
    );
}
