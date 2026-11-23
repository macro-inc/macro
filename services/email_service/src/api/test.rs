use super::{health, mount_at_root_and_prefix, swagger_ui};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::get,
};
use tower::ServiceExt;

async fn ok() -> &'static str {
    "ok"
}

fn sample_app() -> Router {
    mount_at_root_and_prefix(
        Router::new()
            .route("/health", get(ok))
            .route("/email/messages", get(ok))
            .route("/gmail/webhook", get(ok))
            .route("/internal/ping", get(ok)),
    )
}

async fn get_status(app: Router, path: &str) -> StatusCode {
    app.oneshot(
        Request::builder()
            .uri(path)
            .method("GET")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
}

#[tokio::test]
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/email/health"] {
        let response = mount_at_root_and_prefix(health::router())
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn existing_paths_stay_and_are_also_served_under_the_prefix() {
    for path in [
        "/health",
        "/email/health",
        "/email/messages",
        "/email/email/messages",
        "/gmail/webhook",
        "/email/gmail/webhook",
        "/internal/ping",
        "/email/internal/ping",
    ] {
        assert_eq!(
            get_status(sample_app(), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    let response = mount_at_root_and_prefix(health::router())
        .oneshot(
            Request::builder()
                .uri("/missing")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn openapi_is_served_at_root_and_gateway_prefix() {
    let api = swagger_ui();

    for uri in ["/api-doc/openapi.json", "/email/api-doc/openapi.json"] {
        let response = api
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{uri}");
    }
}

/// Prod exports spans at INFO and above, so the API's request span must be
/// an INFO server span carrying the matched route.
#[tokio::test]
async fn api_requests_export_an_info_server_span_with_the_route() {
    use opentelemetry::trace::{SpanKind, TracerProvider as _};
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing_subscriber::{Layer as _, filter::LevelFilter, layer::SubscriberExt as _};

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry().with(
        tracing_opentelemetry::layer()
            .with_tracer(provider.tracer("email-api-test"))
            .with_filter(LevelFilter::INFO),
    );
    let _guard = tracing::subscriber::set_default(subscriber);
    let app = mount_at_root_and_prefix(super::traced(
        Router::new().route("/outlook/webhook/{attempt}", axum::routing::post(ok)),
    ));
    let request = || {
        Request::builder()
            .uri("/email/outlook/webhook/0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10")
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
    assert_eq!(route.as_deref(), Some("/email/outlook/webhook/{attempt}"));
}
