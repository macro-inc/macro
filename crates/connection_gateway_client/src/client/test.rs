use super::ConnectionGatewayClient;
use opentelemetry::trace::{TraceContextExt as _, TracerProvider as _};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

#[test]
fn outbound_request_includes_current_trace_context() {
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    tracing::subscriber::with_default(subscriber, || {
        let client = ConnectionGatewayClient::new("secret".into(), "http://gateway".into());
        let span = tracing::info_span!("caller");
        let _guard = span.enter();
        let request = client
            .with_trace_headers(client.client.get("http://gateway/track/user/123"))
            .build()
            .unwrap();

        let traceparent = request
            .headers()
            .get("traceparent")
            .expect("traceparent should be injected")
            .to_str()
            .unwrap();
        let trace_id = span.context().span().span_context().trace_id().to_string();
        assert!(traceparent.contains(&trace_id));
    });
}
