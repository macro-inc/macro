use crate::{api::context::ApiContext, config::Config};
use anyhow::Context;
use axum::Router;
use axum::routing::get;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use metering_db_client::{MeteringDb, paths};
use remote_env_var::LocalOrRemoteSecret;
use sqlx::PgPool;
use tower::ServiceBuilder;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod context;
pub mod health;
pub mod swagger;
pub mod usage;

pub async fn setup_and_serve(config: &Config, db: PgPool) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();
    let metering_db = MeteringDb::new(db);

    let app = api_router(config.internal_auth_key.clone())
        .with_state(ApiContext { db: metering_db })
        .layer(cors.clone())
        .nest("/health", health::router().layer(cors))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap();

    tracing::info!(
        "metering service is up and running on port {}",
        &config.port
    );

    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router(key: LocalOrRemoteSecret<InternalApiSecretKey>) -> Router<ApiContext> {
    let router = Router::new()
        .nest(paths::USAGE, usage::router())
        .route("/internal/health", get(async move || "healthy"))
        .layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                key,
                macro_middleware::auth::internal_access::handler,
            )),
        );

    Router::new()
        .nest("/:version", router.clone())
        .merge(router)
}
