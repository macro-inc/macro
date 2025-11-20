use crate::api::context::ApiContext;
use anyhow::Context;
use config::{Config, Environment};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

mod api;
mod config;
mod constants;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::info!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (3, 20),
        Environment::Local => (3, 10),
    };

    // Connect to macrodb (contains properties tables and permission tables)
    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.database_url)
        .await
        .context("could not connect to macrodb")?;

    tracing::info!(
        min_connections,
        max_connections,
        "initialized macrodb connection"
    );

    let secretsmanager_client =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ));
    tracing::info!("initialized secretsmanager client");

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let internal_auth_key =
        secretsmanager_client::LocalOrRemoteSecret::Local(InternalApiSecretKey::new()?);
    tracing::info!("initialized internal auth key");

    let comms_service_client = comms_service_client::CommsServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.comms_service_url.clone(),
    );
    tracing::info!(
        comms_service_url = %config.comms_service_url,
        "initialized comms service client"
    );

    let comms_client = Arc::new(comms_service_client);

    // ========== Hexagonal Architecture Setup ==========

    // Create outbound adapters (storage and permission checker)
    let properties_storage = properties_service::outbound::PropertiesPgStorage::new(db.clone());
    let permission_checker = properties_service::outbound::PgPermissionChecker::new();

    // Compose unified domain service (handles definitions, options, and entity properties)
    let property_service = Arc::new(
        properties_service::domain::services::PropertyServiceImpl::new(
            properties_storage,
            permission_checker,
        ),
    );

    tracing::info!("hexagonal architecture services initialized");
    // ===================================================

    api::setup_and_serve(ApiContext {
        db,
        jwt_args,
        config: Arc::new(config),
        internal_auth_key,
        comms_service_client: comms_client,
        property_service,
    })
    .await?;
    Ok(())
}
