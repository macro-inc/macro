use std::sync::Arc;

use crate::api::context::AppState;
use anyhow::Context;
use config::{Config, Environment};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;

mod api;
mod config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let env = Environment::new_or_prod();
    MacroEntrypoint::new(env).init();

    let secretsmanager_client =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ));

    let internal_secret_key = secretsmanager_client
        .get_maybe_secret_value(env, InternalApiSecretKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 25),
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

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    api::setup_and_serve(AppState {
        db,
        jwt_args,
        internal_secret_key,
        config: Arc::new(config),
    })
    .await?;

    Ok(())
}
