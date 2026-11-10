mod calendar_event_forward;
mod calendar_invitations;
pub(crate) mod read_receipts;
use anyhow::Context;
use axum::Router;
use context::ApiContext;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use std::time::Duration;
use tower::ServiceBuilder;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Routes
mod health;

mod email;

// Misc
pub(crate) mod context;
pub(crate) mod gmail;
mod internal;
mod middleware;
mod outlook;
pub(crate) mod swagger;

#[cfg(test)]
mod test;

const GATEWAY_PATH_PREFIX: &str = "/email";
/// A request slower than this logs a warning.
const SLOW_REQUEST: Duration = Duration::from_millis(200);

pub(crate) async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let env = state.config.environment;
    let correlation =
        agent_correlation::inbound::CorrelationState::new(state.db.clone(), state.jwt_args.clone());
    let port = state.config.port;
    let unsubscribe = traced_without_path(
        email_sequences::inbound::public_unsubscribe::unsubscribe_router(state.sequences.clone()),
    );
    let traced_api = traced(api_router(state.clone()).with_state(state).layer(
        axum::middleware::from_fn_with_state(correlation, agent_correlation::inbound::propagate),
    ));
    let health = health::router();
    let app =
        mount_at_root_and_prefix(traced_api.merge(unsubscribe).merge(health)).merge(swagger_ui());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!(
        "service is up and running with environment {:?} on port {}",
        env,
        port
    );
    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(macro_entrypoint::shutdown_signal())
        .await
        .context("error starting service")
}

/// Wraps the API in the request id, server span, CORS and compression layers.
/// The server span is the shared INFO-level `http.request` span that adopts an
/// incoming `traceparent`; tower-http's default span is DEBUG, below the
/// exporter's filter, so the API would send no server spans.
fn traced(api: Router) -> Router {
    api.layer(
        ServiceBuilder::new()
            .layer(MacroRequestIdAndTracingLayer::new(SLOW_REQUEST).into_inner())
            .layer(macro_cors::cors_layer())
            .layer(CompressionLayer::new().gzip(true)),
    )
}

/// [`traced`]'s server span without `url.path`, for routes whose path holds a
/// secret: the public unsubscribe page's token. It records the matched route.
/// Mail clients call the page, so there is no `traceparent` to adopt.
fn traced_without_path(page: Router) -> Router {
    use axum::extract::MatchedPath;
    use macro_tower_layers::{CustomOnFailure, CustomOnResponse};
    use tracing::field::Empty;

    page.layer(
        TraceLayer::new_for_http()
            .make_span_with(|request: &axum::http::Request<_>| {
                let span = tracing::info_span!(
                    "http.request",
                    otel.kind = "server",
                    "http.request.method" = %request.method(),
                    "http.route" = Empty,
                    "http.response.status_code" = Empty,
                    latency_ms = Empty,
                    otel.status_code = Empty,
                    otel.status_description = Empty,
                );
                if let Some(route) = request.extensions().get::<MatchedPath>() {
                    span.record("http.route", route.as_str());
                }
                span
            })
            .on_request(())
            .on_response(CustomOnResponse::new_with_threshold(SLOW_REQUEST))
            .on_failure(CustomOnFailure),
    )
}

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(GATEWAY_PATH_PREFIX, inner)
}

fn swagger_ui() -> Router {
    Router::new()
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .merge(
            SwaggerUi::new("/email/docs")
                .url("/email/api-doc/openapi.json", swagger::ApiDoc::openapi()),
        )
}

fn api_router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/email/threads/{thread_id}/calendar-invitations",
            axum::routing::get(calendar_invitations::handler),
        )
        .route(
            "/email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy",
            axum::routing::post(calendar_invitations::copy_handler),
        )
        .route(
            "/email/calendar-events/{event_id}/forward",
            axum::routing::post(calendar_event_forward::handler),
        )
        .route(
            "/email/threads/{thread_id}/read-receipts",
            axum::routing::get(read_receipts::thread),
        )
        // Fetched by recipients' mail clients, so it takes no credentials.
        .route("/opens/{token}", axum::routing::get(read_receipts::pixel))
        .nest("/email", email::router(state))
        .nest("/gmail", gmail::router())
        .nest("/outlook", outlook::router())
        .nest("/internal", internal::router())
}
