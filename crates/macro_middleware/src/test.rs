use axum::{Router, body::Body, http::Request, middleware, routing::post};
use tower::ServiceExt;
use tracing::Instrument;
use tracing_subscriber::util::SubscriberInitExt;

use super::connection_drop_prevention_handler;

/// The span current in the handler, by id, as the response body.
async fn current_span_id() -> String {
    tracing::Span::current()
        .id()
        .map(|id| id.into_u64().to_string())
        .unwrap_or_default()
}

#[tokio::test]
async fn a_mutation_runs_its_handler_in_the_request_span() {
    let _subscriber = tracing_subscriber::registry().set_default();
    let app = Router::new()
        .route("/", post(current_span_id))
        .layer(middleware::from_fn(connection_drop_prevention_handler));
    let request_span = tracing::info_span!("http.request");
    let request_span_id = request_span.id().map(|id| id.into_u64().to_string());

    let response = app
        .oneshot(Request::post("/").body(Body::empty()).unwrap())
        .instrument(request_span)
        .await
        .unwrap();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();

    assert_eq!(
        Some(String::from_utf8(body.to_vec()).unwrap()),
        request_span_id
    );
}
