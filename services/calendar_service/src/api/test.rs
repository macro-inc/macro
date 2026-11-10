use super::{mount_at_root_and_prefix, traced};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::post,
};
use opentelemetry::trace::{SpanKind, TracerProvider as _};
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tower::ServiceExt;
use tracing_subscriber::{Layer as _, filter::LevelFilter, layer::SubscriberExt as _};

async fn ok() -> &'static str {
    "ok"
}

/// Prod exports spans at INFO and above, so the API's request span must be
/// an INFO server span carrying the matched route.
#[tokio::test]
async fn api_requests_export_an_info_server_span_with_the_route() {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry().with(
        tracing_opentelemetry::layer()
            .with_tracer(provider.tracer("calendar-api-test"))
            .with_filter(LevelFilter::INFO),
    );
    let _guard = tracing::subscriber::set_default(subscriber);
    let app = mount_at_root_and_prefix(traced(Router::new().route("/events/{event_id}", post(ok))));
    let request = || {
        Request::builder()
            .uri("/calendar/events/0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10")
            .method("POST")
            .body(Body::empty())
            .unwrap()
    };
    // The first request registers the span's callsite. Another test thread
    // may have cached a "never" interest for it, so recompute it and measure
    // the second request.
    app.clone().oneshot(request()).await.unwrap();
    tracing::callsite::rebuild_interest_cache();
    exporter.reset();

    // The response body holds the request span open; dropping it ends it.
    let status = app.oneshot(request()).await.unwrap().status();
    assert_eq!(status, StatusCode::OK);

    let spans = exporter.get_finished_spans().unwrap();
    let [span] = spans.as_slice() else {
        panic!("expected one exported span, got {spans:?}");
    };
    assert_eq!(span.span_kind, SpanKind::Server);
    let route = span
        .attributes
        .iter()
        .find(|attribute| attribute.key.as_str() == "http.route")
        .map(|attribute| attribute.value.to_string());
    assert_eq!(route.as_deref(), Some("/calendar/events/{event_id}"));
}
