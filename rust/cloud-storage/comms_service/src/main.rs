use crate::api::context::{AppState, DocumentPermissionJwtSecretKey};
use anyhow::Context;
use config::{Config, Environment};
use connection_gateway_client::ConnectionGatewayClient;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_var;
use secretsmanager_client::{LocalOrRemoteSecret, SecretManager};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::net::TcpListener;

mod api;
mod config;
mod constants;
mod notification;
mod service;
mod utils;

env_var! {
    struct MacroDbUrl;
}

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (3, 20),
        Environment::Local => (3, 10),
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

    let secretsmanager_client =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ));
    tracing::trace!("initialized secretsmanager client");

    let macro_notify_client = macro_notify::MacroNotify::new(
        config.notification_queue.clone(),
        "comms_service".to_string(),
    )
    .await;
    tracing::trace!("initialized macro_notify client");

    let document_storage_service_client =
        document_storage_service_client::DocumentStorageServiceClient::new(
            config.internal_auth_key.as_ref().to_string(),
            config.document_storage_service_url.clone(),
        );

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await,
    ))
    .contacts_queue(&config.contacts_queue)
    .search_event_queue(&config.search_event_queue);

    let macro_db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(10)
        .connect(
            LocalOrRemoteSecret::new_from_secret_manager(
                MacroDbUrl::new()?,
                &secretsmanager_client,
            )
            .await?
            .as_ref(),
        )
        .await?;

    let auth_service_secret_key = match config.environment {
        Environment::Local => config.auth_service_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.auth_service_secret_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let auth_service_client = authentication_service_client::AuthServiceClient::new(
        auth_service_secret_key,
        config.auth_service_url.clone(),
    );

    let permissions_token_secret = secretsmanager_client
        .get_maybe_secret_value(config.environment, DocumentPermissionJwtSecretKey::new()?)
        .await?;

    let jwt_validation_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let connection_gateway_client = ConnectionGatewayClient::new(
        config.internal_auth_key.as_ref().to_string(),
        config.connection_gateway_url.clone(),
    );

    let listener = TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .context("failed to bind to port")?;

    tracing::info!(
        "comms service is up and running with environment {:?} on port {}",
        &config.environment,
        &config.port
    );

    let service = api::service(AppState {
        jwt_validation_args,
        internal_auth_key: secretsmanager_client::LocalOrRemoteSecret::Local(
            config.internal_auth_key.clone(),
        ),

        db,
        sqs_client: Arc::new(sqs_client),
        macro_notify_client: Arc::new(macro_notify_client),
        document_storage_service_client: Arc::new(document_storage_service_client),
        auth_service_client: Arc::new(auth_service_client),
        connection_gateway_client: Arc::new(connection_gateway_client),
        permissions_token_secret,
        frecency_storage: FrecencyPgStorage::new(macro_db),
    });

    axum::serve(listener, service)
        .await
        .context("error starting service")?;

    Ok(())
}
