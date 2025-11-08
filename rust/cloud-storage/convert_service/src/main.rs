use crate::api::context::ApiContext;
use anyhow::Context;
use config::Config;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use process::runner::run_worker;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

mod api;
mod config;
mod model;
mod process;
mod utils;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let env = Environment::new_or_prod();
    MacroEntrypoint::new(env).init();

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let internal_auth_key = secretsmanager_client
        .get_maybe_secret_value(env, InternalApiSecretKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!("initialized config");

    let queue_aws_config = if cfg!(feature = "local_queue") {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .endpoint_url(&config.convert_queue)
            .load()
            .await
    } else {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await
    };

    let s3_client = s3_client::S3::new(aws_sdk_s3::Client::new(&aws_config));
    tracing::trace!("initialized s3 client");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&queue_aws_config))
        .convert_queue(&config.convert_queue);
    tracing::trace!("initialized sqs client");

    if !cfg!(feature = "disable_worker") {
        let sqs_client = aws_sdk_sqs::Client::new(&queue_aws_config);
        let sqs_worker = sqs_worker::SQSWorker::new(
            sqs_client,
            config.convert_queue.clone(),
            config.queue_max_messages,
            config.queue_wait_time_seconds,
        );
        let s3_client = s3_client.clone();
        let lambda_client = lambda_client::Lambda::new(aws_sdk_lambda::Client::new(&aws_config));

        tokio::spawn(async move { run_worker(sqs_worker, s3_client, lambda_client).await });
    }

    api::setup_and_serve(ApiContext {
        db,
        s3_client,
        sqs_client: Arc::new(sqs_client),
        internal_auth_key,
        config: Arc::new(config),
    })
    .await?;
    Ok(())
}
