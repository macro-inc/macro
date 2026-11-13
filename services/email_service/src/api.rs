mod calendar_event_forward;
mod calendar_invitations;
pub(crate) mod read_receipts;
use anyhow::Context;
use axum::Router;
use context::ApiContext;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use std::time::Duration;
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;
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

pub(crate) async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let env = state.config.environment;
    let port = state.config.port;
    let app = app(state);

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

/// Builds the complete production HTTP surface without opening a listener.
pub(crate) fn app(state: ApiContext) -> Router {
    let correlation = state.correlation.clone();
    let traced_api = traced(api_router(state.clone()).with_state(state).layer(
        axum::middleware::from_fn_with_state(correlation, agent_correlation::inbound::propagate),
    ));
    let health = health::router();
    mount_at_root_and_prefix(traced_api.merge(health)).merge(swagger_ui())
}

/// Wraps the API in the request id, server span, CORS and compression layers.
/// The server span is the shared INFO-level `http.request` span that adopts an
/// incoming `traceparent`; tower-http's default span is DEBUG, below the
/// exporter's filter, so the API would send no server spans.
fn traced(api: Router) -> Router {
    api.layer(
        ServiceBuilder::new()
            .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
            .layer(macro_cors::cors_layer())
            .layer(CompressionLayer::new().gzip(true)),
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
