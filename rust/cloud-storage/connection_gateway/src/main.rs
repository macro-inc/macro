#![recursion_limit = "256"]
mod api;
mod config;
mod constants;
mod context;
mod model;
mod service;
use std::{sync::Arc, time::Duration};

use crate::{api::router, config::EnvVars, context::AppState};
use anyhow::{Context, Result};
use axum::http::{
    Method,
    header::{AUTHORIZATION, CONTENT_TYPE},
};
use config::Config;
use constants::ORIGINS;
use frecency::{
    domain::services::{EventIngestorImpl, PullAggregatorImpl},
    inbound::polling_aggregator::FrecencyAggregatorWorkerHandle,
    outbound::{
        postgres::{FrecencyPgProcessor, FrecencyPgStorage},
        time::DefaultTime,
    },
};
use last_online_tracker::{
    domain::services::LastOnlineService,
    inbound::LastOnlineWorker,
    outbound::{redis::RedisLastOnlineRepo, time::DefaultTime as LastOnlineDefaultTime},
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use service::dynamodb::create_dynamo_db_connection_manager;
use service::redis::poll_messages;
use sqlx::postgres::PgPoolOptions;
use stream::outbound::redis_pg::{RedisPostgresStreamManager, RedisPostgresStreamRepo};
use tower_http::cors::CorsLayer;

env_var!(
    struct MacroDbUrl;
);

#[tokio::main]
#[tracing::instrument(ret, err)]
async fn main() -> Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Arc::new(Config::from_env(EnvVars::unwrap_new()));

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );
    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    // allow requests from any origin
    let cors = CorsLayer::new()
        .allow_credentials(true)
        .allow_headers(vec![AUTHORIZATION, CONTENT_TYPE])
        .allow_methods(vec![
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_origin(ORIGINS);

    let dynamodb_client = aws_sdk_dynamodb::Client::new(&aws_config);

    let redis_client = Arc::new(
        redis::Client::open(config.redis_host.as_ref())
            .inspect(|client| {
                client
                    .get_connection()
                    .map(|_| tracing::trace!("initialized redis connection"))
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "failed to connect to redis");
                    })
                    .ok();
            })
            .context("failed to connect to redis")?,
    );

    let connection_manager = create_dynamo_db_connection_manager(dynamodb_client.clone()).await?;

    let last_online_redis_conn = redis_client.get_multiplexed_async_connection().await?;
    let last_online_worker = Arc::new(LastOnlineWorker::new(LastOnlineService::new(
        LastOnlineDefaultTime,
        RedisLastOnlineRepo::new(last_online_redis_conn),
    )));
    let pgpool = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(20)
        .connect(
            LocalOrRemoteSecret::new_from_secret_manager(
                MacroDbUrl::new()?,
                &secretsmanager_client,
            )
            .await?
            .as_ref(),
        )
        .await?;

    let stream_service = RedisPostgresStreamRepo::new((*redis_client).clone(), pgpool.clone());
    let stream_manager = RedisPostgresStreamManager::new(stream_service.obj());

    let context = context::ApiContext {
        connection_manager,
        redis_client: Arc::clone(&redis_client),
        frecency_ingestor_service: EventIngestorImpl::new(FrecencyPgStorage::new(pgpool.clone())),
        stream_manager,
        last_online_worker,
    };

    tokio::spawn(poll_messages(context.clone()));

    let app = router(AppState {
        context,
        config: Arc::clone(&config),
        jwt_args,
        internal_auth_key: LocalOrRemoteSecret::Local(InternalApiSecretKey::new()?),
        frecency_worker: Arc::new(FrecencyAggregatorWorkerHandle::new_worker(
            PullAggregatorImpl::new(FrecencyPgProcessor::new(pgpool), DefaultTime),
            Duration::from_secs(60),
        )),
    })
    .layer(cors);

    tracing::info!(
        "connection gateway is up and running with environment {:?} on port {}",
        config.environment,
        config.port
    );

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .context("failed to bind to port")?;

    axum::serve(listener, app.into_make_service())
        .await
        .context("failed to serve")?;

    Ok(())
}
