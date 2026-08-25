use super::*;
use axum::{Router, body::Body, routing::get};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use tower::ServiceExt;
use tower_http::trace::{MakeSpan, OnFailure, OnResponse};
use tracing::{
    Level,
    field::{Field, Visit},
    subscriber::{set_default, with_default},
};

#[derive(Default)]
struct CapturedTracing {
    event_levels: Mutex<Vec<Level>>,
    span_level: Mutex<Option<Level>>,
    span_target: Mutex<Option<String>>,
    declared_span_fields: Mutex<HashSet<String>>,
    initial_span_fields: Mutex<HashMap<String, String>>,
    recorded_span_fields: Mutex<HashMap<String, String>>,
}

impl CapturedTracing {
    fn event_count(&self, level: Level) -> usize {
        self.event_levels
            .lock()
            .unwrap()
            .iter()
            .filter(|event_level| **event_level == level)
            .count()
    }
}

struct FieldCapture<'a>(&'a mut HashMap<String, String>);

impl Visit for FieldCapture<'_> {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

struct TracingCapture {
    captured: Arc<CapturedTracing>,
}

impl TracingCapture {
    fn new() -> (Self, Arc<CapturedTracing>) {
        let captured = Arc::new(CapturedTracing::default());
        (
            Self {
                captured: captured.clone(),
            },
            captured,
        )
    }
}

impl tracing::Subscriber for TracingCapture {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, attrs: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        *self.captured.span_level.lock().unwrap() = Some(*attrs.metadata().level());
        *self.captured.span_target.lock().unwrap() = Some(attrs.metadata().target().to_owned());
        *self.captured.declared_span_fields.lock().unwrap() = attrs
            .metadata()
            .fields()
            .iter()
            .map(|field| field.name().to_owned())
            .collect();
        attrs.record(&mut FieldCapture(
            &mut self.captured.initial_span_fields.lock().unwrap(),
        ));
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, values: &tracing::span::Record<'_>) {
        values.record(&mut FieldCapture(
            &mut self.captured.recorded_span_fields.lock().unwrap(),
        ));
    }

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        self.captured
            .event_levels
            .lock()
            .unwrap()
            .push(*event.metadata().level());
    }

    fn enter(&self, _span: &tracing::span::Id) {}

    fn exit(&self, _span: &tracing::span::Id) {}
}

#[test]
fn request_span_uses_info_and_safe_structured_fields() {
    let (subscriber, captured) = TracingCapture::new();

    with_default(subscriber, || {
        let request = Request::builder()
            .method("POST")
            .uri("/documents/123?access_token=secret")
            .header("authorization", "Bearer secret")
            .header("x-request-id", "request-42")
            .body(())
            .unwrap();
        let mut make_span = MakeHttpRequestSpan;
        let _span = make_span.make_span(&request);
    });

    assert_eq!(*captured.span_level.lock().unwrap(), Some(Level::INFO));
    assert_eq!(
        captured.span_target.lock().unwrap().as_deref(),
        Some(HTTP_REQUEST_SPAN_TARGET)
    );

    let declared_fields = captured.declared_span_fields.lock().unwrap();
    assert!(declared_fields.contains("http.request.method"));
    assert!(declared_fields.contains("http.route"));
    assert!(declared_fields.contains("url.path"));
    assert!(declared_fields.contains("request.id"));
    assert!(declared_fields.contains("http.response.status_code"));
    assert!(declared_fields.contains("latency_ms"));
    assert!(!declared_fields.contains("headers"));
    drop(declared_fields);

    let fields = captured.initial_span_fields.lock().unwrap();
    assert_eq!(fields.get("http.request.method").unwrap(), "POST");
    assert_eq!(fields.get("url.path").unwrap(), "\"/documents/123\"");
    assert_eq!(fields.get("request.id").unwrap(), "\"request-42\"");
    assert!(fields.values().all(|value| !value.contains("secret")));
}

#[tokio::test]
async fn request_span_records_the_matched_route() {
    let (subscriber, captured) = TracingCapture::new();
    let _guard = set_default(subscriber);
    let app = Router::new()
        .route("/documents/{id}", get(|| async {}))
        .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner());

    app.oneshot(
        Request::builder()
            .uri("/documents/123")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();

    assert_eq!(
        captured
            .recorded_span_fields
            .lock()
            .unwrap()
            .get("http.route")
            .unwrap(),
        "\"/documents/{id}\""
    );
}

#[test]
fn successful_response_records_telemetry_without_completion_event() {
    let (subscriber, captured) = TracingCapture::new();

    with_default(subscriber, || {
        let request = Request::builder().uri("/documents").body(()).unwrap();
        let span = MakeHttpRequestSpan.make_span(&request);
        let response = Response::builder().status(204).body(()).unwrap();
        CustomOnResponse::new_with_threshold(Duration::from_millis(200)).on_response(
            &response,
            Duration::from_millis(50),
            &span,
        );
    });

    assert!(captured.event_levels.lock().unwrap().is_empty());
    let fields = captured.recorded_span_fields.lock().unwrap();
    assert_eq!(fields.get("http.response.status_code").unwrap(), "204");
    assert_eq!(fields.get("latency_ms").unwrap(), "50");
}

#[test]
fn slow_response_emits_one_warning() {
    let (subscriber, captured) = TracingCapture::new();

    with_default(subscriber, || {
        let request = Request::builder().uri("/documents").body(()).unwrap();
        let span = MakeHttpRequestSpan.make_span(&request);
        let response = Response::builder().status(200).body(()).unwrap();
        CustomOnResponse::new_with_threshold(Duration::from_millis(200)).on_response(
            &response,
            Duration::from_millis(200),
            &span,
        );
    });

    assert_eq!(captured.event_count(Level::WARN), 1);
    assert_eq!(captured.event_count(Level::INFO), 0);
    assert_eq!(captured.event_count(Level::ERROR), 0);
}

#[test]
fn server_error_emits_only_failure_event() {
    let (subscriber, captured) = TracingCapture::new();

    with_default(subscriber, || {
        let request = Request::builder().uri("/documents").body(()).unwrap();
        let span = MakeHttpRequestSpan.make_span(&request);
        let response = Response::builder().status(500).body(()).unwrap();
        let latency = Duration::from_millis(300);

        CustomOnResponse::new_with_threshold(Duration::from_millis(200))
            .on_response(&response, latency, &span);
        CustomOnFailure.on_failure("Status code: 500", latency, &span);
    });

    assert_eq!(captured.event_count(Level::ERROR), 1);
    assert_eq!(captured.event_count(Level::WARN), 0);
    assert_eq!(captured.event_count(Level::INFO), 0);

    let fields = captured.recorded_span_fields.lock().unwrap();
    assert_eq!(fields.get("http.response.status_code").unwrap(), "500");
    assert_eq!(fields.get("latency_ms").unwrap(), "300");
    assert_eq!(fields.get("otel.status_code").unwrap(), "\"ERROR\"");
}

#[tokio::test]
async fn starvation_detector_warns_when_runtime_blocked() {
    let (subscriber, captured) = TracingCapture::new();
    let _guard = set_default(subscriber);

    spawn_starvation_detector(Duration::from_millis(10));

    // Let the detector initialize, consume its first tick, and enter the timing loop
    tokio::time::sleep(Duration::from_millis(15)).await;

    // Block the runtime thread — simulates starvation
    std::thread::sleep(Duration::from_millis(50));

    // Let the detector observe the delay and emit the warning
    tokio::time::sleep(Duration::from_millis(15)).await;

    assert_eq!(captured.event_count(Level::WARN), 1);
}

#[test]
fn header_extractor_extracts_w3c_traceparent() {
    let propagator = opentelemetry_sdk::propagation::TraceContextPropagator::new();
    let mut headers = http::HeaderMap::new();
    headers.insert(
        "traceparent",
        "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3cb55c13-01"
            .parse()
            .unwrap(),
    );

    let cx = opentelemetry::propagation::TextMapPropagator::extract(
        &propagator,
        &opentelemetry_http::HeaderExtractor(&headers),
    );

    let span_context = cx.span().span_context().clone();
    assert!(span_context.is_valid());
    assert!(span_context.is_remote());
    assert_eq!(
        span_context.trace_id().to_string(),
        "5b8aa5a2d2c872e8321cf37308d69df2"
    );
    assert_eq!(span_context.span_id().to_string(), "051581bf3cb55c13");
}

#[test]
fn request_span_adopts_remote_traceparent() {
    use opentelemetry::trace::TracerProvider as _;
    use tracing_subscriber::layer::SubscriberExt;

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    // Provider with no exporter: spans are created (so parentage is real) but
    // never shipped anywhere.
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    with_default(subscriber, || {
        let request = http::Request::builder()
            .uri("/test")
            .header(
                "traceparent",
                "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3cb55c13-01",
            )
            .body(())
            .unwrap();

        let span = MakeSpanWithRemoteParent.make_span(&request);
        let trace_id = span.context().span().span_context().trace_id();
        assert_eq!(
            trace_id.to_string(),
            "5b8aa5a2d2c872e8321cf37308d69df2",
            "request span should continue the remote trace"
        );
    });
}

#[test]
fn request_span_without_traceparent_stays_root() {
    use opentelemetry::trace::TracerProvider as _;
    use tracing_subscriber::layer::SubscriberExt;

    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    with_default(subscriber, || {
        let request = http::Request::builder().uri("/test").body(()).unwrap();
        let span = MakeSpanWithRemoteParent.make_span(&request);
        let trace_id = span.context().span().span_context().trace_id();
        assert_ne!(
            trace_id.to_string(),
            "5b8aa5a2d2c872e8321cf37308d69df2",
            "no traceparent should mean a fresh trace"
        );
    });
}

#[test]
fn inject_trace_headers_emits_current_span_traceparent() {
    use opentelemetry::trace::TracerProvider as _;
    use tracing_subscriber::layer::SubscriberExt;

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    with_default(subscriber, || {
        let span = tracing::info_span!("outbound_call");
        let _guard = span.enter();

        let mut headers = http::HeaderMap::new();
        inject_trace_headers(&mut headers);
        let traceparent = headers
            .get("traceparent")
            .expect("traceparent header should be injected inside a span")
            .to_str()
            .unwrap();
        let trace_id = span.context().span().span_context().trace_id().to_string();
        assert!(
            traceparent.contains(&trace_id),
            "traceparent {traceparent} should carry the current trace id {trace_id}"
        );
    });
}

#[test]
fn inject_trace_headers_is_a_noop_outside_a_span() {
    let mut headers = http::HeaderMap::new();
    inject_trace_headers(&mut headers);
    assert!(headers.get("traceparent").is_none());
}

#[tokio::test]
async fn starvation_detector_does_not_warn_within_grace_period() {
    tokio::time::pause();

    let (subscriber, captured) = TracingCapture::new();
    let _guard = set_default(subscriber);

    spawn_starvation_detector(Duration::from_millis(50));

    // Let the detector initialize and consume its first tick
    tokio::task::yield_now().await;

    // Advance time by interval + 4ms, within the 5ms grace period
    tokio::time::advance(Duration::from_millis(54)).await;
    tokio::task::yield_now().await;

    assert_eq!(captured.event_count(Level::WARN), 0);
}
