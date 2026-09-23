use anyhow::Context;
use axum::Router;
use context::ApiContext;
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
pub(crate) mod swagger;

#[cfg(test)]
mod test;

const GATEWAY_PATH_PREFIX: &str = "/email";

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let env = state.config.environment;
    let port = state.config.port;
    let traced_api = api_router(state.clone()).with_state(state).layer(
        ServiceBuilder::new()
            .layer(TraceLayer::new_for_http())
            .layer(macro_cors::cors_layer())
            .layer(CompressionLayer::new().gzip(true)),
    );
    let health = health::router();
    let app = mount_at_root_and_prefix(traced_api.merge(health)).merge(swagger_ui());

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
        .nest("/email", email::router(state))
        .nest("/gmail", gmail::router())
        .nest("/internal", internal::router())
}
