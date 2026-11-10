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

/// Sends `request` through `app` twice and returns the span the second one
/// exported at INFO. The first request registers the span's callsite: another
/// test thread may have cached a "never" interest for it, so it is recomputed.
async fn exported_span(
    app: Router,
    request: impl Fn() -> Request<Body>,
) -> opentelemetry_sdk::trace::SpanData {
    use opentelemetry::trace::TracerProvider as _;
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
    app.clone().oneshot(request()).await.unwrap();
    tracing::callsite::rebuild_interest_cache();
    exporter.reset();

    // The response body holds the request span open; dropping it ends it.
    let status = app.oneshot(request()).await.unwrap().status();
    assert_eq!(status, StatusCode::OK);

    let mut spans = exporter.get_finished_spans().unwrap();
    assert_eq!(spans.len(), 1, "expected one exported span, got {spans:?}");
    spans.remove(0)
}

fn attribute(span: &opentelemetry_sdk::trace::SpanData, key: &str) -> Option<String> {
    span.attributes
        .iter()
        .find(|attribute| attribute.key.as_str() == key)
        .map(|attribute| attribute.value.to_string())
}

fn post(path: &'static str) -> impl Fn() -> Request<Body> {
    move || {
        Request::builder()
            .uri(path)
            .method("POST")
            .body(Body::empty())
            .unwrap()
    }
}

/// Prod exports spans at INFO and above, so the API's request span must be
/// an INFO server span carrying the matched route.
#[tokio::test]
async fn api_requests_export_an_info_server_span_with_the_route() {
    let app = mount_at_root_and_prefix(super::traced(
        Router::new().route("/outlook/webhook/{attempt}", axum::routing::post(ok)),
    ));
    let span = exported_span(
        app,
        post("/email/outlook/webhook/0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10"),
    )
    .await;
    assert_eq!(span.span_kind, opentelemetry::trace::SpanKind::Server);
    assert_eq!(
        attribute(&span, "http.route").as_deref(),
        Some("/email/outlook/webhook/{attempt}")
    );
}

/// The unsubscribe page's span carries its route but never the token in its
/// path.
#[tokio::test]
async fn the_unsubscribe_token_stays_out_of_the_server_span() {
    use email_sequences::inbound::public_unsubscribe::UNSUBSCRIBE_PATH;

    let app = mount_at_root_and_prefix(super::traced_without_path(
        Router::new().route(UNSUBSCRIBE_PATH, axum::routing::post(ok)),
    ));
    let span = exported_span(
        app,
        post("/email/public/sequences/unsubscribe/secret-token"),
    )
    .await;
    assert_eq!(span.span_kind, opentelemetry::trace::SpanKind::Server);
    assert_eq!(
        attribute(&span, "http.route"),
        Some(format!("/email{UNSUBSCRIBE_PATH}"))
    );
    assert!(
        span.attributes
            .iter()
            .all(|attribute| !attribute.value.to_string().contains("secret-token")),
        "{:?}",
        span.attributes
    );
}
