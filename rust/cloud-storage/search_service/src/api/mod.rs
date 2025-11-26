use anyhow::Context;
use axum::Router;
use context::ApiContext;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

// Routes
mod health;
mod internal;
mod search;

// Misc
pub(crate) mod context;
mod swagger;

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let env = state.config.environment;
    let app = api_router(state.clone())
        .with_state(state)
        .layer(cors.clone())
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()))
        // The health router is attached here so we don't attach the logging middleware to it
        .merge(health::router().layer(cors))
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
        .await
        .context("error starting service")
}

fn api_router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .nest(
            "/search",
            search::router().layer(axum::middleware::from_fn_with_state(
                state.clone(),
                macro_middleware::auth::decode_jwt::handler,
            )),
        )
        .nest(
            "/internal",
            internal::router().layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state,
                    macro_middleware::auth::internal_access::handler,
                ),
            )),
        )
}
