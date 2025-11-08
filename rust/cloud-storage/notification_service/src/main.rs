use crate::api::context::ApiContext;
use anyhow::Context;
use config::Config;
use connection_gateway_client::client::ConnectionGatewayClient;
use document_cognition_service_client::DocumentCognitionServiceClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

mod api;
mod config;
mod env;
mod model;
mod notification;
mod push_notification_event;
mod templates;

#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    println!("database url: {:?}", &config.database_url);

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

    let secretsmanager_client =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ));

    let internal_secret_key = secretsmanager_client
        .get_maybe_secret_value(config.environment, InternalApiSecretKey::new()?)
        .await?;

    let _dcs_client = DocumentCognitionServiceClient::new(
        internal_secret_key.as_ref().to_string(),
        config.document_cognition_service_url.clone(),
    );

    let conn_gateway_client = ConnectionGatewayClient::new(
        internal_secret_key.as_ref().to_string(),
        config.connection_gateway_url.clone(),
    );

    let notification_queue_aws_config = if cfg!(feature = "local_queue") {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .endpoint_url(&config.notification_queue)
            .load()
            .await
    } else {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await
    };

    let push_delivery_queue_aws_config = if cfg!(feature = "local_queue") {
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .endpoint_url(&config.push_notification_event_handler_queue)
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

    let notification_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&notification_queue_aws_config),
        config.notification_queue.clone(),
        config.notification_queue_max_messages,
        config.notification_queue_wait_time_seconds,
    );

    let push_notification_event_handler_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&push_delivery_queue_aws_config),
        config.push_notification_event_handler_queue.clone(),
        config.notification_queue_max_messages,
        config.notification_queue_wait_time_seconds,
    );

    let ses_client = ses_client::Ses::new(
        aws_sdk_sesv2::Client::new(&aws_config),
        &config.environment.to_string(),
    );
    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));

    let macro_cache_client = macro_cache_client::MacroCache::new(config.redis_uri.as_str());

    #[cfg(feature = "notification_worker")]
    {
        use std::sync::Arc;
        let queue_worker_context = notification::context::QueueWorkerContext {
            db: db.clone(),
            worker: Arc::new(notification_worker),
            conn_gateway_client: Arc::new(conn_gateway_client),
            ses_client: Arc::new(ses_client),
            sns_client: Arc::new(sns_client.clone()),
            macro_cache_client: Arc::new(macro_cache_client),
        };
        // Spawn the runner in a task of it's own so we don't block the main thread
        tokio::spawn(
            async move { notification::run_notification_worker(queue_worker_context).await },
        );
    }

    #[cfg(feature = "push_notification_event_handler")]
    {
        let db = db.clone();
        let sns_client = sns_client.clone();
        tokio::spawn(async move {
            push_notification_event::run_push_notification_event_worker(
                db,
                sns_client,
                push_notification_event_handler_worker,
            )
            .await
        });
    }

    let sns_client = sns_client::SNS::new(aws_sdk_sns::Client::new(&aws_config));

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    api::setup_and_serve(ApiContext {
        db,
        sns_client: Arc::new(sns_client),
        config: Arc::new(config),
        jwt_args,
        internal_secret_key,
    })
    .await?;

    Ok(())
}
