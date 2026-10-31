use super::*;
use opentelemetry::trace::TracerProvider as _;
use tracing::subscriber::with_default;
use tracing_subscriber::layer::SubscriberExt as _;

#[test]
fn adopts_remote_traceparent() {
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    with_default(subscriber, || {
        let request = Request::builder()
            .uri("/health")
            .header(
                "traceparent",
                "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3cb55c13-01",
            )
            .body(())
            .unwrap();
        let span = RequestSpan.make_span(&request);
        assert_eq!(
            span.context().span().span_context().trace_id().to_string(),
            "5b8aa5a2d2c872e8321cf37308d69df2"
        );
        let _entered = span.enter();
        let mut outbound = http::HeaderMap::new();
        inject_trace_headers(&mut outbound);
        assert!(
            outbound
                .get("traceparent")
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("00-5b8aa5a2d2c872e8321cf37308d69df2-")
        );
    });
}
