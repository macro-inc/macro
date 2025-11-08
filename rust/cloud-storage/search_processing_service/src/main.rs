use std::sync::Arc;

use crate::{
    api::context::ApiContext,
    process::{context::SearchProcessingContext, worker::run_search_processing_workers},
};
use anyhow::Context;
use config::{Config, Environment};
use lexical_client::LexicalClient;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use opensearch_client::OpensearchClient;
use rust_embed::RustEmbed;
use secretsmanager_client::{LocalOrRemoteSecret, SecretManager};
use sqlx::postgres::PgPoolOptions;

mod api;
mod config;
mod parsers;
mod process;

#[allow(dead_code)]
#[derive(RustEmbed)]
#[folder = "pdfium-lib/linux/"]
struct PdfiumLib;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;
    tracing::trace!("initialized config");

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .search_event_queue(&config.search_event_queue);

    let s3_client = s3_client::S3::new(aws_sdk_s3::Client::new(&aws_config));

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let database_url = match config.environment {
        Environment::Local => config.database_url.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.database_url)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let opensearch_password = match config.environment {
        Environment::Local => config.opensearch_password.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.opensearch_password)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (3, 25),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    let opensearch_client = OpensearchClient::new(
        config.opensearch_url.clone(),
        config.opensearch_username.clone(),
        opensearch_password,
    )
    .context("unable to create opensearch client")?;

    if let Err(e) = opensearch_client.health().await {
        tracing::error!(error=?e, "error connecting to opensearch");
        return Err(e);
    }

    let internal_auth_key = LocalOrRemoteSecret::Local(InternalApiSecretKey::new()?);

    #[cfg(feature = "processing")]
    {
        use std::sync::Arc;

        let sync_service_auth_key = match config.environment {
            Environment::Local => config.sync_service_auth_key.clone(),
            _ => secretsmanager_client
                .get_secret_value(&config.sync_service_auth_key)
                .await
                .context("unable to get secret")?
                .to_string(),
        };

        let lexical_client = LexicalClient::new(
            sync_service_auth_key.clone(),
            config.lexical_service_url.clone(),
        );

        let email_service_client = email_service_client::EmailServiceClient::new(
            internal_auth_key.as_ref().to_string(),
            config.email_service_url.clone(),
        );

        let comms_service_client = comms_service_client::CommsServiceClient::new(
            internal_auth_key.as_ref().to_string(),
            config.comms_service_url.clone(),
        );

        let worker = sqs_worker::SQSWorker::new(
            aws_sdk_sqs::Client::new(&aws_config),
            config.search_event_queue.clone(),
            config.queue_max_messages,
            config.queue_wait_time_seconds,
        );
        let ctx = SearchProcessingContext {
            db: db.clone(),
            worker: Arc::new(worker.clone()),
            document_storage_bucket: config.document_storage_bucket.clone(),
            s3_client: Arc::new(s3_client),
            opensearch_client: Arc::new(opensearch_client.clone()),
            comms_service_client: Arc::new(comms_service_client),
            lexical_client: Arc::new(lexical_client),
            email_client: email_service_client.into(),
        };
        run_search_processing_workers(ctx, config.worker_count);
    }

    api::setup_and_serve(ApiContext {
        sqs_client: Arc::new(sqs_client),
        opensearch_client: Arc::new(opensearch_client),
        internal_auth_key,
        config: Arc::new(config),
    })
    .await?;
    Ok(())
}
