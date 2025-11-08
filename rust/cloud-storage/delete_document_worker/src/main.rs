use anyhow::Context;
use config::{Config, Environment};
use macro_entrypoint::MacroEntrypoint;
use macro_redis_cluster_client::Redis;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

use crate::context::QueueWorkerContext;

mod api;
mod config;
mod context;
mod process;

#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (1, 30),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    let queue_aws_config = if cfg!(feature = "local_queue") {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .endpoint_url(&config.delete_document_queue)
            .load()
            .await
    } else {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await
    };

    // Normal config for non-local stack items
    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let s3_client = s3_client::S3::new(aws_sdk_s3::Client::new(&aws_config));

    let delete_document_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&queue_aws_config),
        config.delete_document_queue.clone(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let redis_client = redis::cluster::ClusterClient::new(vec![config.redis_uri.clone()])
        .map_err(|e| anyhow::Error::msg(format!("unable to connect to redis {:?}", e)))
        .context("could not connect to redis client")?;
    if let Err(e) = redis_client.get_connection() {
        tracing::error!(error=?e, "unable to connect to redis");
        return Err(e.into());
    }
    let redis_client = Redis::new(redis_client);

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let sync_service_auth_key = match config.environment {
        Environment::Local => config.sync_service_auth_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.sync_service_auth_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let sync_service_client = sync_service_client::SyncServiceClient::new(
        sync_service_auth_key,
        config.sync_service_url.clone(),
    );

    let comms_service_auth_key = match config.environment {
        Environment::Local => config.comms_service_auth_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.comms_service_auth_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let comms_service_client = comms_service_client::CommsServiceClient::new(
        comms_service_auth_key,
        config.comms_service_url.clone(),
    );

    let properties_service_auth_key = match config.environment {
        Environment::Local => config.properties_service_auth_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.properties_service_auth_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let properties_service_client = properties_service_client::PropertiesServiceClient::new(
        properties_service_auth_key,
        config.properties_service_url.clone(),
    );

    let queue_worker_context = QueueWorkerContext {
        db: db.clone(),
        worker: Arc::new(delete_document_worker),
        s3_client: Arc::new(s3_client),
        redis_client: Arc::new(redis_client),
        sync_service_client: Arc::new(sync_service_client),
        comms_service_client: Arc::new(comms_service_client),
        properties_service_client: Arc::new(properties_service_client),
        config: config.clone(),
    };

    // Spawn the runner in a task of it's own so we don't block the main thread
    tokio::spawn(async move { process::run_worker(queue_worker_context).await });

    api::setup_and_serve(&config).await?;

    Ok(())
}
