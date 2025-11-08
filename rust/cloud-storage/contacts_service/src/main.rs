mod api;
mod config;
mod graph;
mod queue;
mod user;
use std::sync::Arc;

use anyhow::Context;
use config::{Config, Environment};
use contacts_service::queue::MessageQueue;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::SecretManager;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use sqs_worker::SQSWorker;

use crate::api::Service;
use crate::api::context::AppState;

async fn connect_to_database(config: &Config) -> anyhow::Result<PgPool> {
    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    let database_url = &config.database_url;

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(database_url)
        .await
        .context("could not connect to db")?;
    Ok(db)
}

async fn create_sqs_worker(config: &Config) -> SQSWorker {
    let queue_url = config.queue_url.clone();
    let aws_config = match config.environment {
        Environment::Local => {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .endpoint_url(&queue_url)
                .load()
                .await
        }
        _ => {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await
        }
    };
    let sqs_client = aws_sdk_sqs::Client::new(&aws_config);
    sqs_worker::SQSWorker::new(
        sqs_client,
        queue_url,
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    )
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env().context("expected to be able to generate config")?;

    let db = connect_to_database(&config).await?;
    let db_clone = db.clone();
    let sqs_worker = create_sqs_worker(&config).await;
    let mut worker = MessageQueue::new(sqs_worker, db_clone);

    let secretsmanager_client =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ));

    let internal_api_secret = secretsmanager_client
        .get_maybe_secret_value(config.environment, InternalApiSecretKey::new()?)
        .await?;

    tokio::spawn(async move {
        worker.poll().await;
    });

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    api::setup_and_serve(AppState {
        config: Arc::new(config),
        db,
        jwt_args,
        internal_api_secret,
        contacts_service: Arc::new(Service),
    })
    .await?;
    Ok(())
}
