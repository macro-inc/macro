//! The service's composition root: reads config and wires every adapter and
//! domain service into the HTTP server.

use crate::api;
use crate::composition::api::{ApiDependencies, api_context};
use anyhow::Context;
use document_storage_service_client::DocumentStorageServiceClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env::Environment;
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use macro_service_urls::{
    AuthServiceUrl, ConnectionGatewayUrl, DocumentStorageServiceUrl, StaticFileServiceUrl,
};
use sqlx::postgres::PgPoolOptions;
use static_file_service_client::StaticFileServiceClient;
use std::time::Duration;
use tokio_util::task::TaskTracker;

/// Build the service from the environment and serve until shutdown.
// Not a `pub async fn`: see CS-73.
pub fn run() -> impl Future<Output = anyhow::Result<()>> {
    run_server()
}

async fn run_server() -> anyhow::Result<()> {
    let env = Environment::new_or_prod();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let s3_client = s3_client::S3::new(macro_aws_config::s3_client().await);

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    // Parse our configuration from the environment, then resolve any secret-manager backed values.
    let config = crate::config::Config::from_env()
        .context("expected to be able to generate config")?
        .resolve_remote_secrets(env, &secretsmanager_client)
        .await
        .context("expected to be able to resolve config secrets")?;

    // limiting to max of 200 connections (12.5% of macrodb total) in prod.
    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (3, 20),
        Environment::Develop => (1, 10),
        Environment::Local => (1, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.macro_db_url)
        .await
        .context("could not connect to db")?;

    let gmail_inbox_sync_queue = macro_queues::GmailInboxSyncQueue::new();
    let gmail_inbox_sync_retry_queue = macro_queues::GmailInboxSyncRetryQueue::new();
    let gmail_ops_queue = macro_queues::GmailOpsQueue::new();
    let backfill_queue = macro_queues::EmailBackfillQueue::new();
    let email_scheduled_queue = macro_queues::EmailScheduledQueue::new();
    let sfs_uploader_queue = macro_queues::SfsUploaderQueue::new();
    let link_manager_queue = macro_queues::LinkManagerQueue::new();
    let sqs_client = sqs_client::SQS::new(macro_aws_config::sqs_client().await)
        .gmail_inbox_sync_queue(&gmail_inbox_sync_queue)
        .gmail_inbox_sync_retry_queue(&gmail_inbox_sync_retry_queue)
        .gmail_ops_queue(&gmail_ops_queue)
        .gmail_label_write_batches(config.gmail_label_write_batches_enabled)
        .email_backfill_queue(&backfill_queue)
        .email_scheduled_queue(&email_scheduled_queue)
        .sfs_uploader_queue(&sfs_uploader_queue)
        .email_link_manager_queue(&link_manager_queue);

    let auth_service_client = authentication_service_client::AuthServiceClient::new(
        config
            .authentication_service_secret_key
            .as_ref()
            .to_string(),
        AuthServiceUrl::new()?.to_string(),
    );

    let gmail_client = gmail_client::GmailClient::new(config.gmail_gcp_queue.as_ref().to_string());
    let redis_inner_client = redis::Client::open(config.redis_uri.as_ref())
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

    let redis_client = crate::util::redis::RedisClient::new(
        redis_inner_client,
        config.redis_rate_limit_window_secs,
    );

    let sfs_client = StaticFileServiceClient::new(
        config.internal_api_key.to_string(),
        StaticFileServiceUrl::new()?.to_string(),
    );

    let dss_client = DocumentStorageServiceClient::new(
        config.internal_api_key.to_string(),
        DocumentStorageServiceUrl::new()?.to_string(),
    );

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;
    let event_broker_tracker = TaskTracker::new();
    let macro_event_broker = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        event_broker_tracker.clone(),
    );
    let connection_gateway_client = connection_gateway_client::client::ConnectionGatewayClient::new(
        config.internal_api_key.to_string(),
        ConnectionGatewayUrl::new()?.to_string(),
    );
    let contacts_ingress = std::sync::Arc::new(contacts::domain::service::SqsContactsIngress {
        queue: contacts::outbound::ingress::SqsContactsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            macro_queues::ContactsQueue::new().to_string(),
        ),
    });
    let read_receipts = crate::composition::read_receipts(db.clone(), env)?;
    let state = api_context(ApiDependencies {
        read_receipts,
        config,
        db,
        sqs_client,
        contacts_ingress,
        s3_client,
        gmail_client,
        redis_client,
        auth_service_client,
        sfs_client,
        dss_client,
        connection_gateway_client,
        jwt_args,
        macro_event_broker,
    })
    .await?;
    let api_result = api::setup_and_serve(state).await;

    tracing::info!("waiting for event broker publishes to drain");
    event_broker_tracker.close();
    match tokio::time::timeout(EVENT_BROKER_DRAIN_TIMEOUT, event_broker_tracker.wait()).await {
        Ok(()) => tracing::info!("event broker publishes drained"),
        Err(error) => {
            tracing::warn!(
                error=?error,
                timeout_seconds = EVENT_BROKER_DRAIN_TIMEOUT.as_secs(),
                "timed out waiting for event broker publishes to drain"
            );
        }
    }

    api_result
}

const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);
