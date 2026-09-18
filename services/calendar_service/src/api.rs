use anyhow::Context;
use axum::Router;
use calendar_events::inbound::mutation_router::{
    CalendarMutationRouterState, calendar_mutation_router,
};
use context::ApiContext;
use tower::ServiceBuilder;
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod context;

mod calendar_watch;
pub mod swagger;

/// Path prefix the shared gateway ALB forwards unmodified. Dual-mounted
/// alongside `/` so a dedicated ALB keeps working during cutover.
const GATEWAY_PATH_PREFIX: &str = "/calendar";

/// Build the application and serve it until a shutdown signal arrives.
pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let env = state.config.environment;
    let port = state.config.port;
    let traced_api = api_router(state.clone()).with_state(state).layer(
        ServiceBuilder::new()
            .layer(TraceLayer::new_for_http())
            .layer(macro_cors::cors_layer())
            .layer(CompressionLayer::new().gzip(true)),
    );
    let health = crate::health::router();
    let app = mount_at_root_and_prefix(traced_api.merge(health)).merge(swagger_ui());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!(
        "calendar service is up and running with environment {:?} on port {}",
        env,
        port
    );
    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(macro_entrypoint::shutdown_signal())
        .await
        .context("error starting service")
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
            SwaggerUi::new("/calendar/docs")
                .url("/calendar/api-doc/openapi.json", swagger::ApiDoc::openapi()),
        )
}

fn api_router(state: ApiContext) -> Router<ApiContext> {
    // Calendar mutations follow the calendar sync kill switch: without sync a
    // provider write would never be reflected locally.
    if state.config.calendar_sync_enabled {
        calendar_watch::router().merge(calendar_mutation_router(CalendarMutationRouterState::new(
            state.calendar_mutation_service.clone(),
            state.authorization_state.clone(),
        )))
    } else {
        calendar_watch::router()
    }
}
