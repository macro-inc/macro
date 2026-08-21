#![recursion_limit = "256"]
mod api;
mod config;
mod constants;
mod context;
mod model;
mod service;
use std::{sync::Arc, time::Duration};

use crate::{
    api::router,
    context::{AppState, AuthorizationService},
};
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
use macro_authorization::{InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationState};
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use service::dynamodb::create_dynamo_db_connection_manager;
use service::redis::poll_messages;
use sqlx::postgres::PgPoolOptions;
use stream::outbound::redis_pg::{RedisPostgresStreamManager, RedisPostgresStreamRepo};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use tower_http::cors::CorsLayer;

const SHUTDOWN_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

#[tokio::main]
#[tracing::instrument(ret, err)]
async fn main() -> Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

#[tracing::instrument(ret, err)]
async fn run() -> Result<()> {
    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    // Parse our configuration from the environment.
    let config = Config::from_env()?
        .resolve_remote_secrets(Environment::new_or_prod(), &secretsmanager_client)
        .await?;

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

    let redis_connection = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to create shared redis connection")?;
    let last_online_worker = Arc::new(LastOnlineWorker::new(LastOnlineService::new(
        LastOnlineDefaultTime,
        RedisLastOnlineRepo::new(redis_connection.clone()),
    )));
    let pgpool = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(20)
        .connect(config.macro_db_url.as_ref())
        .await?;

    let stream_service = RedisPostgresStreamRepo::new((*redis_client).clone(), pgpool.clone());
    let stream_manager = RedisPostgresStreamManager::new(stream_service.obj());

    let context = context::ApiContext {
        connection_manager,
        redis_client: Arc::clone(&redis_client),
        redis_connection,
        frecency_ingestor_service: EventIngestorImpl::new(FrecencyPgStorage::new(pgpool.clone())),
        stream_manager,
        last_online_worker,
    };

    let config = Arc::new(config);
    let authorization_state = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        MacroAuthJwtValidator::new(jwt_args),
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
    )));

    let app = router(AppState {
        context: context.clone(),
        config: Arc::clone(&config),
        authorization_state,
        frecency_worker: Arc::new(FrecencyAggregatorWorkerHandle::new_worker(
            PullAggregatorImpl::new(FrecencyPgProcessor::new(pgpool), DefaultTime),
            Duration::from_secs(60),
        )),
    })
    .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
    .layer(cors);

    tracing::info!(
        "connection gateway is up and running with environment {:?} on port {}",
        config.environment,
        config.port
    );

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .context("failed to bind to port")?;

    let http_shutdown = CancellationToken::new();
    let redis_shutdown = CancellationToken::new();
    let mut tasks = JoinSet::new();
    tasks.spawn({
        let http_shutdown = http_shutdown.clone();
        async move {
            let result = axum::serve(listener, app.into_make_service())
                .with_graceful_shutdown(http_shutdown.cancelled_owned())
                .await
                .context("failed to serve");
            ("http", result)
        }
    });
    tasks.spawn({
        let redis_shutdown = redis_shutdown.clone();
        async move {
            let result = poll_messages(context, redis_shutdown).await;
            ("redis poller", result)
        }
    });

    let mut run_error = None;
    tokio::select! {
        () = macro_entrypoint::shutdown_signal() => {}
        result = tasks.join_next() => {
            run_error = Some(match result {
                Some(Ok((name, Ok(())))) => anyhow::anyhow!("{name} stopped unexpectedly"),
                Some(Ok((name, Err(error)))) => error.context(format!("{name} stopped")),
                Some(Err(error)) => anyhow::anyhow!("gateway task failed: {error}"),
                None => anyhow::anyhow!("gateway tasks stopped unexpectedly"),
            });
        }
    }

    http_shutdown.cancel();
    redis_shutdown.cancel();
    let drain = async {
        while let Some(result) = tasks.join_next().await {
            match result {
                Ok((_, Ok(()))) => {}
                Ok((name, Err(error))) => {
                    tracing::error!(error=?error, task=name, "gateway task failed during shutdown");
                    if run_error.is_none() {
                        run_error = Some(error.context(format!("{name} failed during shutdown")));
                    }
                }
                Err(error) if error.is_cancelled() => {}
                Err(error) => {
                    tracing::error!(error=?error, "gateway task failed during shutdown");
                    if run_error.is_none() {
                        run_error = Some(anyhow::anyhow!(
                            "gateway task failed during shutdown: {error}"
                        ));
                    }
                }
            }
        }
    };
    if tokio::time::timeout(SHUTDOWN_DRAIN_TIMEOUT, drain)
        .await
        .is_err()
    {
        tracing::warn!(
            timeout_seconds = SHUTDOWN_DRAIN_TIMEOUT.as_secs(),
            "timed out draining gateway tasks; aborting remaining work"
        );
        tasks.abort_all();
        while let Some(result) = tasks.join_next().await {
            if let Err(error) = result
                && !error.is_cancelled()
            {
                tracing::error!(error=?error, "gateway task failed during cancellation");
            }
        }
    }

    match run_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
