use super::*;
use opentelemetry::trace::{SpanId, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use serde_json::json;
use tracing_subscriber::layer::SubscriberExt as _;

#[test]
fn context_survives_serialization_and_is_replaced_for_each_prompt() {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let _guard = tracing::subscriber::set_default(subscriber);
    let mut meta = Map::from_iter([("other/client".to_owned(), json!({"keep": true}))]);
    let mut expected = Vec::new();
    for _ in 0..2 {
        let parent = tracing::info_span!(parent: None, "invocation");
        let context = parent.context();
        let parent_context = context.span().span_context().clone();
        inject(&parent, &mut meta);
        let wire = serde_json::to_string(&meta).expect("serialize metadata");
        let received = serde_json::from_str(&wire).expect("deserialize metadata");
        let child = tracing::info_span!(parent: None, "runtime");
        set_parent(&child, Some(&received));
        assert_eq!(
            child.context().span().span_context().trace_id(),
            parent_context.trace_id()
        );
        expected.push(parent_context);
    }
    assert_eq!(meta["other/client"], json!({"keep": true}));
    provider.force_flush().expect("flush");
    let spans = exporter.get_finished_spans().expect("spans");
    let children: Vec<_> = spans.iter().filter(|s| s.name == "runtime").collect();
    assert_eq!(children.len(), 2);
    for (child, parent) in children.iter().zip(&expected) {
        assert_eq!(child.parent_span_id, parent.span_id());
        assert_ne!(child.parent_span_id, SpanId::INVALID);
    }
    assert_ne!(expected[0].trace_id(), expected[1].trace_id());
    inject(&tracing::Span::none(), &mut meta);
    assert!(
        !meta.contains_key(TRACE_CONTEXT),
        "clear stale context when tracing is off"
    );
    assert!(meta.contains_key("other/client"));
}

#[test]
fn invalid_metadata_does_not_attach_an_unrelated_ambient_context() {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let provider = SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let _guard = tracing::subscriber::set_default(subscriber);
    let unrelated = tracing::info_span!("unrelated");
    let _context = unrelated.context().attach();
    for value in [
        Value::Null,
        json!("bad"),
        json!({"traceparent": "invalid"}),
        json!({"traceparent": 5}),
    ] {
        let meta = Map::from_iter([(TRACE_CONTEXT.to_owned(), value)]);
        let child = tracing::info_span!(parent: None, "runtime");
        let before = child.context().span().span_context().trace_id();
        set_parent(&child, Some(&meta));
        set_parent(&child, None);
        assert_eq!(child.context().span().span_context().trace_id(), before);
    }
}
