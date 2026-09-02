use anyhow::Context;
use axum::Router;
use context::ApiContext;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub(crate) mod context;

// Routes
mod backfill;
mod convert;
mod health;

// Misc
mod swagger;

#[cfg(test)]
mod test;

/// Path prefix the shared gateway ALB forwards unmodified. Dual-mounted
/// alongside `/` so the dedicated ALB keeps working during cutover.
const GATEWAY_PATH_PREFIX: &str = "/convert";

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let env = state.config.environment;
    let traced_api = api_router()
        .with_state(state)
        .layer(cors.clone())
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()));
    // Health stays outside TraceLayer so the probe does not generate request logs.
    let health = health::router().layer(cors);
    let app = mount_at_root_and_prefix(traced_api.merge(health))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .merge(
            SwaggerUi::new("/convert/docs")
                .url("/convert/api-doc/openapi.json", swagger::ApiDoc::openapi()),
        );

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!(
        "service is up and running with environment {:?} on port {}",
        env,
        port
    );
    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(GATEWAY_PATH_PREFIX, inner)
}

fn api_router() -> Router<ApiContext> {
    Router::new().nest(
        "/internal",
        Router::new()
            .nest("/convert", convert::router())
            .nest("/backfill", backfill::router())
            .layer(ServiceBuilder::new().layer(axum::middleware::from_fn(
                macro_middleware::connection_drop_prevention_handler,
            ))),
    )
}
