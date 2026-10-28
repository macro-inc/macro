use super::*;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use tracing_subscriber::layer::SubscriberExt as _;

/// An OpenTelemetry pipeline that keeps finished spans in memory, installed as
/// the thread's default subscriber for the returned guard's lifetime.
fn otel_test_pipeline() -> (
    InMemorySpanExporter,
    SdkTracerProvider,
    tracing::subscriber::DefaultGuard,
) {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    // Other tests in this binary run the same code paths with no subscriber
    // installed, which can cache "never interested" for a span callsite on
    // another thread; recompute so this subscriber sees every span.
    tracing::callsite::rebuild_interest_cache();
    (exporter, provider, guard)
}

fn finished(exporter: &InMemorySpanExporter, provider: &SdkTracerProvider) -> Vec<SpanData> {
    provider.force_flush().expect("flush");
    exporter.get_finished_spans().expect("finished spans")
}

fn attribute<'a>(span: &'a SpanData, key: &str) -> Option<&'a Value> {
    span.attributes
        .iter()
        .find(|kv| kv.key.as_str() == key)
        .map(|kv| &kv.value)
}

#[test]
fn setters_write_attributes_and_status_to_the_otel_span() {
    let (exporter, provider, _guard) = otel_test_pipeline();

    {
        let span = tracing::info_span!("work");
        span.set_str("s", "text");
        span.set_i64("i", -3);
        span.set_u64("u", u64::MAX);
        span.set_f64("f", 0.5);
        span.set_bool("b", true);
        span.set_str_array("a", ["x", "y"]);
        span.set_error("boom", "it broke");
    }

    let spans = finished(&exporter, &provider);
    assert_eq!(spans.len(), 1);
    let span = &spans[0];
    assert_eq!(span.name, "work");
    assert_eq!(attribute(span, "s"), Some(&Value::String("text".into())));
    assert_eq!(attribute(span, "i"), Some(&Value::I64(-3)));
    assert_eq!(attribute(span, "u"), Some(&Value::I64(i64::MAX)));
    assert_eq!(attribute(span, "f"), Some(&Value::F64(0.5)));
    assert_eq!(attribute(span, "b"), Some(&Value::Bool(true)));
    assert_eq!(
        attribute(span, "a"),
        Some(&Value::Array(Array::String(vec!["x".into(), "y".into()])))
    );
    assert_eq!(
        attribute(span, attr::ERROR_TYPE),
        Some(&Value::String("boom".into()))
    );
    assert!(
        matches!(&span.status, Status::Error { description } if description == "it broke"),
        "{:?}",
        span.status
    );
}

#[test]
fn setters_are_noops_without_an_otel_layer() {
    // No subscriber at all: nothing to write to, nothing to panic about.
    let span = tracing::info_span!("quiet");
    span.set_str("k", "v");
    span.set_error("e", "d");
    assert!(span.is_disabled());
}

#[test]
fn current_span_is_named_matches_the_entered_span_only() {
    let (_exporter, _provider, _guard) = otel_test_pipeline();
    assert!(!current_span_is_named("outer"));
    let outer = tracing::info_span!("outer");
    let _entered = outer.enter();
    assert!(current_span_is_named("outer"));
    assert!(!current_span_is_named("inner"));
    {
        let inner = tracing::info_span!("inner");
        let _entered = inner.enter();
        assert!(current_span_is_named("inner"));
        assert!(!current_span_is_named("outer"));
    }
    assert!(current_span_is_named("outer"));
}
