use super::*;

/// The ACP dispatcher and spawned prompt task must restore context from each
/// request, rather than inheriting the connection's context or the last turn.
#[tokio::test]
async fn prompt_trace_context_reaches_the_engine_for_each_turn() {
    use opentelemetry::trace::{TraceContextExt as _, TracerProvider as _};
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    struct TracedEngine;
    impl TurnEngine for TracedEngine {
        fn supported_models(&self) -> &[&str] {
            crate::testing::TEST_MODELS
        }

        fn run_turn(
            &self,
            _request: TurnRequest,
        ) -> tokio::sync::mpsc::Receiver<Result<StreamPart, agent::AgentError>> {
            let _work = tracing::info_span!("engine.work");
            let (_sender, receiver) = tokio::sync::mpsc::channel(1);
            receiver
        }
    }

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let _guard = tracing::subscriber::set_default(subscriber);
    // While exactly one dispatcher is registered, tracing-core caches each
    // new span callsite's interest from the registering thread's default
    // subscriber. Other tests in this binary hit the prompt callsite with no
    // subscriber, which would cache "never interested" and disable the span
    // on this thread too. A second registered dispatcher makes tracing-core
    // combine every registered subscriber's interest instead, so the cache
    // stays "sometimes" and each thread's own default subscriber decides.
    let _pin_interest = tracing::Dispatch::new(tracing::subscriber::NoSubscriber::default());
    let (_, _, parents) = with_agent(Arc::new(TracedEngine), async |connection, session| {
        let mut parents = Vec::new();
        for _ in 0..2 {
            let parent = tracing::info_span!(parent: None, "invocation");
            parents.push(parent.context().span().span_context().clone());
            let mut request = text_prompt(&session, "test prompt");
            let mut meta = Meta::new();
            genai_telemetry::propagation::inject(&parent, &mut meta);
            request.meta = Some(meta);
            connection
                .send_request(request)
                .block_task()
                .await
                .expect("prompt response");
        }
        parents
    })
    .await;
    provider.force_flush().expect("flush");
    let spans = exporter.get_finished_spans().expect("spans");
    assert_ne!(parents[0].trace_id(), parents[1].trace_id());
    for parent in parents {
        let prompt = spans
            .iter()
            .find(|span| {
                span.name == "agent.acp.prompt" && span.span_context.trace_id() == parent.trace_id()
            })
            .expect("ACP prompt stays in its caller's trace");
        assert_eq!(prompt.parent_span_id, parent.span_id());
        let work = spans
            .iter()
            .find(|span| {
                span.name == "engine.work" && span.span_context.trace_id() == parent.trace_id()
            })
            .expect("engine runs in the prompt trace");
        assert_eq!(work.parent_span_id, prompt.span_context.span_id());
    }
}
