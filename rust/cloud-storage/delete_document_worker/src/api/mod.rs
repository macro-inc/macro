use crate::config::Config;
use anyhow::Context;
use axum::Router;

mod health;

pub async fn setup_and_serve(config: &Config) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let app = api_router().merge(health::router()).layer(cors.clone());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap();
    tracing::info!(
        "notification service is up and running with environment {:?} on port {}",
        &config.environment,
        &config.port
    );
    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router() -> Router {
    Router::new()
}
