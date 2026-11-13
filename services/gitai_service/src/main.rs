//! Composition root of gitai-service.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use gitai::domain::models::SharedKey;
use gitai::domain::service::GitaiService;
use gitai::outbound::{dynamodb::DynamoIndex, otel_metrics::OtelMetrics, s3::S3Storage};
use gitai_service::config::Config;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;

const PORT: u16 = 8080;
/// The gateway forwards `/gitai/...` unchanged, so every route is also
/// mounted under this prefix.
const GATEWAY_PATH_PREFIX: &str = "/gitai";

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), rootcause::Report> {
    let config = macro_config::ConfigLoader::load::<Config>()?;

    let shared_key = SharedKey::new(config.gitai_shared_key.to_string())
        .map_err(|error| rootcause::report!("GITAI_SHARED_KEY: {error}"))?;

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let service = Arc::new(GitaiService::new(
        S3Storage::new(
            macro_aws_config::s3_client().await,
            config.gitai_events_bucket.to_string(),
            config.gitai_sessions_bucket.to_string(),
        ),
        DynamoIndex::new(
            aws_sdk_dynamodb::Client::new(&aws_config),
            config.gitai_table.to_string(),
        ),
        OtelMetrics::new(),
        shared_key,
    ));

    let routes = gitai::inbound::http::router(service).layer(
        ServiceBuilder::new()
            .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
            .layer(macro_cors::cors_layer())
            .layer(CompressionLayer::new().gzip(true)),
    );
    let app = Router::new()
        .merge(routes.clone())
        .nest(GATEWAY_PATH_PREFIX, routes);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await?;
    tracing::info!(port = PORT, "gitai-service listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}
