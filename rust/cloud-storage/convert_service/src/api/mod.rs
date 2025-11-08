use anyhow::Context;
use axum::Router;
use context::ApiContext;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use remote_env_var::LocalOrRemoteSecret;
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

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let env = state.config.environment;
    let app = api_router(state.internal_auth_key.clone())
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

fn api_router(internal_api_key: LocalOrRemoteSecret<InternalApiSecretKey>) -> Router<ApiContext> {
    Router::new().nest(
        "/internal",
        Router::new()
            .nest("/convert", convert::router())
            .nest("/backfill", backfill::router())
            .layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        internal_api_key,
                        macro_middleware::auth::internal_access::handler,
                    ))
                    .layer(axum::middleware::from_fn(
                        macro_middleware::connection_drop_prevention_handler,
                    )),
            ),
    )
}
