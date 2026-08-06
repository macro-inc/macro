use anyhow::Context;
use axum::Router;
use calendar_events::inbound::mutation_router::CalendarMutationRouterState;
use context::ApiContext;
use tower::ServiceBuilder;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Routes
mod health;

mod calendar_watch;
mod email;

// Misc
pub(crate) mod context;
pub(crate) mod gmail;
mod internal;
mod middleware;
pub(crate) mod swagger;

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let env = state.config.environment;
    let port = state.config.port;
    let app = api_router(state.clone())
        .with_state(state)
        .merge(health::router())
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(macro_cors::cors_layer())
                .layer(CompressionLayer::new().gzip(true)),
        )
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

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

fn api_router(state: ApiContext) -> Router<ApiContext> {
    // Calendar mutations follow the calendar sync kill switch: without sync
    // a provider write would never be reflected locally.
    let calendar_router = if state.config.calendar_sync_enabled {
        calendar_watch::router().merge(
            calendar_events::inbound::mutation_router::calendar_mutation_router(
                CalendarMutationRouterState::new(
                    state.calendar_mutation_service.clone(),
                    state.authorization_state.clone(),
                ),
            ),
        )
    } else {
        calendar_watch::router()
    };
    Router::new()
        .nest("/email", email::router(state))
        .nest("/gmail", gmail::router())
        .nest("/internal", internal::router())
        .nest("/calendar", calendar_router)
}
