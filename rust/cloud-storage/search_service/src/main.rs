use crate::api::context::ApiContext;
use anyhow::Context;
use comms_service_client::CommsServiceClient;
use config::{Config, Environment};
use document_storage_service_client::DocumentStorageServiceClient;
use email_service_client::EmailServiceClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use opensearch_client::OpensearchClient;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

mod api;
mod config;
mod model;
mod util;

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

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

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
        .context("failed to connect to macrodb")?;

    let opensearch_password = match config.environment {
        Environment::Local => config.opensearch_password.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.opensearch_password)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

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

    let comms_service_client = CommsServiceClient::new(
        config.internal_auth_key.as_ref().to_string(),
        config.comms_service_url.clone(),
    );

    let dss_client = DocumentStorageServiceClient::new(
        config.internal_auth_key.as_ref().to_string(),
        config.dss_url.clone(),
    );

    let email_service_client = EmailServiceClient::new(
        config.internal_auth_key.as_ref().to_string(),
        config.email_service_url.clone(),
    );

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    api::setup_and_serve(ApiContext {
        db,
        opensearch_client: Arc::new(opensearch_client),
        comms_service_client: Arc::new(comms_service_client),
        dss_client: Arc::new(dss_client),
        email_service_client: Arc::new(email_service_client),
        jwt_args,
        internal_auth_key: secretsmanager_client::LocalOrRemoteSecret::Local(
            InternalApiSecretKey::new()?,
        ),
        config: Arc::new(config),
    })
    .await?;
    Ok(())
}
