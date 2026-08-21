//! The outbound ACP send span must hang off the caller's span, not off the
//! pump task that happens to perform the write.
//!
//! Its own test binary on purpose: asserting what a subscriber recorded means
//! owning the process-wide tracing dispatcher for the duration, which cannot be
//! done reliably beside other tests that build transports of their own.

use agent_client_protocol::schema::v1::{PromptRequest, RequestId, SessionId};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_harness::outbound::sidecar::SidecarTransport;
use agent_runtime_protocol::domain::ports::{Transport as _, TransportSender as _};
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToRuntimeMessage};
use opentelemetry::trace::{SpanId, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tokio::net::TcpListener;
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

fn frame() -> RawJsonRpcMessage {
    let (method, params) = PromptRequest::new(SessionId::new("acp-test"), vec!["hello".into()])
        .to_untyped_message()
        .expect("the typed request should convert to an ACP message")
        .into_parts();
    RawJsonRpcMessage::request(method, params, RequestId::Number(1))
        .expect("typed request params should produce a valid ACP frame")
}

#[tokio::test]
async fn websocket_send_span_keeps_the_callers_parent() {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    // A thread default rather than a per-future one: the pump is a spawned task,
    // and it can only inherit a subscriber that is current when it is spawned.
    let parent_id = {
        let _guard = tracing::subscriber::set_default(subscriber);

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("binding a local port should succeed");
        let address = listener
            .local_addr()
            .expect("a bound listener should have an address");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("the client should connect");
            tokio_tungstenite::accept_async(stream)
                .await
                .expect("the upgrade should succeed")
        });
        let (client, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
            .await
            .expect("dialing the sidecar should succeed");
        let _sidecar = server.await.expect("the accept task should not panic");
        let (outbound, _inbound) = SidecarTransport::connect(client).split();

        let parent = tracing::info_span!("command");
        let parent_id = parent.context().span().span_context().span_id();
        outbound
            .send(ToRuntimeMessage::Acp(AcpMessage(frame())))
            .instrument(parent)
            .await
            .expect("sending should succeed");
        parent_id
    };

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let send = spans
        .iter()
        .find(|span| span.name == "agent.acp.websocket_send")
        .expect("websocket send span");
    assert_ne!(parent_id, SpanId::INVALID);
    assert_eq!(send.parent_span_id, parent_id);
}
