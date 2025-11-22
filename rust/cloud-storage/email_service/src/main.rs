use crate::api::context::ApiContext;
use crate::config::CloudfrontSignerPrivateKey;
use anyhow::Context;
use config::{Config, Environment};
use document_storage_service_client::DocumentStorageServiceClient;
use email::{domain::service::EmailServiceImpl, inbound::EmailPreviewState, outbound::EmailPgRepo};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::{LocalOrRemoteSecret, SecretManager};
use sqlx::postgres::PgPoolOptions;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;

mod api;
mod config;
mod pubsub;
mod util;
mod utils;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let s3_client = s3_client::S3::new(aws_sdk_s3::Client::new(&aws_config));

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let cloudfront_signer_private_key = secretsmanager_client
        .get_maybe_secret_value(env, CloudfrontSignerPrivateKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config = Config::from_env(cloudfront_signer_private_key)
        .context("expected to be able to generate config")?;

    let auth_service_secret_key = match config.environment {
        Environment::Local => config.auth_service_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(config.auth_service_secret_key.clone())
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    // limiting to max of 400 connections (25% of macrodb total) in prod. (10 service + 30 backfill) * 10 pod max
    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (3, 10),
        Environment::Develop => (1, 10),
        Environment::Local => (1, 10),
    };

    let (min_connections_backfill, max_connections_backfill): (u32, u32) = match config.environment
    {
        Environment::Production => (3, 30),
        Environment::Develop => (1, 30),
        Environment::Local => (1, 50),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.macro_db_url)
        .await
        .context("could not connect to db")?;

    let db_backfill = PgPoolOptions::new()
        .min_connections(min_connections_backfill)
        .max_connections(max_connections_backfill)
        .connect(&config.macro_db_url)
        .await
        .context("could not connect to backfill db")?;

    let gmail_queue_aws_config = if cfg!(feature = "local_queue") {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .endpoint_url(&config.gmail_webhook_queue)
            .load()
            .await
    } else {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await
    };

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&gmail_queue_aws_config))
        .gmail_webhook_queue(&config.gmail_webhook_queue)
        .search_event_queue(&config.search_event_queue)
        .insight_context_queue(&config.insight_context_queue)
        .email_backfill_queue(&config.backfill_queue)
        .email_scheduled_queue(&config.email_scheduled_queue)
        .sfs_uploader_queue(&config.sfs_uploader_queue)
        .contacts_queue(&config.contacts_queue);

    let macro_notify_client = macro_notify::MacroNotify::new(
        config.notification_queue.clone(),
        "email_service".to_string(),
    )
    .await;

    let refresh_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
        config.email_refresh_queue.clone(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let scheduled_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
        config.email_scheduled_queue.clone(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let sfs_uploader_workers = (0..config.sfs_uploader_workers)
        .map(|_| {
            sqs_worker::SQSWorker::new(
                aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
                config.sfs_uploader_queue.clone(),
                config.queue_max_messages,
                config.queue_wait_time_seconds,
            )
        })
        .collect::<Vec<_>>();

    let backfill_workers = (0..config.backfill_queue_workers)
        .map(|_| {
            sqs_worker::SQSWorker::new(
                aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
                config.backfill_queue.clone(),
                config.backfill_queue_max_messages,
                config.queue_wait_time_seconds,
            )
        })
        .collect::<Vec<_>>();

    let webhook_workers = (0..config.webhook_queue_workers)
        .map(|_| {
            sqs_worker::SQSWorker::new(
                aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
                config.gmail_webhook_queue.clone(),
                config.webhook_queue_max_messages,
                config.queue_wait_time_seconds,
            )
        })
        .collect::<Vec<_>>();

    let auth_service_client = authentication_service_client::AuthServiceClient::new(
        auth_service_secret_key,
        config.auth_service_url.clone(),
    );

    let gmail_client = gmail_client::GmailClient::new(config.gmail_gcp_queue.clone());

    let redis_inner_client = redis::Client::open(config.redis_uri.as_str())
        .inspect(|client| {
            client
                .get_connection()
                .map(|_| tracing::info!("initialized redis connection"))
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to connect to redis");
                })
                .ok();
        })
        .context("failed to connect to redis")?;

    let redis_client = util::redis::RedisClient::new(
        redis_inner_client,
        config.redis_rate_limit_reqs,
        config.redis_rate_limit_window_secs,
    );

    let internal_auth_key = InternalApiSecretKey::new()?;

    let sfs_client = StaticFileServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.static_file_service_url.clone(),
    );

    let dss_client = DocumentStorageServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_storage_service_url.clone(),
    );

    let connection_gateway_client = connection_gateway_client::client::ConnectionGatewayClient::new(
        internal_auth_key.as_ref().to_string(),
        config.connection_gateway_url.clone(),
    );

    for worker in webhook_workers {
        let db_webhook = db.clone();
        let sqs_client_webhook = sqs_client.clone();
        let gmail_client_webhook = gmail_client.clone();
        let auth_service_client_webhook = auth_service_client.clone();
        let redis_client_webhook = redis_client.clone();
        let macro_notify_client_webhook = macro_notify_client.clone();
        let sfs_client_webhook = sfs_client.clone();
        let connection_gateway_client_webhook = connection_gateway_client.clone();
        let dss_client_webhook = dss_client.clone();
        tokio::spawn(async move {
            pubsub::webhook::worker::run_worker(
                db_webhook,
                worker,
                sqs_client_webhook,
                gmail_client_webhook,
                auth_service_client_webhook,
                redis_client_webhook,
                macro_notify_client_webhook,
                sfs_client_webhook,
                connection_gateway_client_webhook,
                dss_client_webhook,
                config.notifications_enabled,
            )
            .await;
        });
    }
    tracing::info!(
        num_workers = config.webhook_queue_workers,
        "webhook workers started"
    );

    for worker in backfill_workers {
        let db_backfill = db_backfill.clone();
        let sqs_client_backfill = sqs_client.clone();
        let gmail_client_backfill = gmail_client.clone();
        let auth_service_client_backfill = auth_service_client.clone();
        let redis_client_backfill = redis_client.clone();
        let macro_notify_client_backfill = macro_notify_client.clone();
        let sfs_client_backfill = sfs_client.clone();
        let connection_gateway_client_backfill = connection_gateway_client.clone();
        let dss_client_backfill = dss_client.clone();
        tokio::spawn(async move {
            pubsub::backfill::worker::run_worker(
                db_backfill,
                worker,
                sqs_client_backfill,
                gmail_client_backfill,
                auth_service_client_backfill,
                redis_client_backfill,
                macro_notify_client_backfill,
                sfs_client_backfill,
                connection_gateway_client_backfill,
                dss_client_backfill,
                config.notifications_enabled,
            )
            .await;
        });
    }
    tracing::info!(
        num_workers = config.backfill_queue_workers,
        "backfill workers started"
    );

    let db_refresh = db.clone();
    let gmail_client_refresh = gmail_client.clone();
    let auth_service_client_refresh = auth_service_client.clone();
    let redis_client_refresh = redis_client.clone();
    let sqs_client_refresh = sqs_client.clone();
    tokio::spawn(async move {
        pubsub::refresh::worker::run_worker(
            refresh_worker,
            db_refresh,
            gmail_client_refresh,
            auth_service_client_refresh,
            redis_client_refresh,
            sqs_client_refresh,
        )
        .await;
    });

    let db_scheduled = db.clone();
    let gmail_client_scheduled = gmail_client.clone();
    let auth_service_client_scheduled = auth_service_client.clone();
    let redis_client_scheduled = redis_client.clone();
    tokio::spawn(async move {
        pubsub::scheduled::worker::run_worker(
            scheduled_worker,
            db_scheduled,
            gmail_client_scheduled,
            auth_service_client_scheduled,
            redis_client_scheduled,
        )
        .await;
    });

    if !cfg!(feature = "disable_sfs_map") {
        for worker in sfs_uploader_workers {
            let db_sfs_uploader = db.clone();
            let sfs_client_sfs_uploader = sfs_client.clone();
            tokio::spawn(async move {
                pubsub::sfs_uploader::worker::run_worker(
                    worker,
                    db_sfs_uploader,
                    sfs_client_sfs_uploader,
                )
                .await;
            });
        }
        tracing::info!(
            num_workers = config.sfs_uploader_workers,
            "sfs uploader workers started"
        );
    }

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    api::setup_and_serve(ApiContext {
        db: db.clone(),
        config: Arc::new(config),
        auth_service_client: Arc::new(auth_service_client),
        redis_client: Arc::new(redis_client),
        sqs_client: Arc::new(sqs_client),
        sfs_client: Arc::new(sfs_client),
        gmail_client: Arc::new(gmail_client),
        s3_client: Arc::new(s3_client),
        dss_client: Arc::new(dss_client),
        jwt_args,
        internal_auth_key: LocalOrRemoteSecret::Local(internal_auth_key),
        email_cursor_service: EmailPreviewState::new(EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db)),
        )),
    })
    .await?;
    Ok(())
}
