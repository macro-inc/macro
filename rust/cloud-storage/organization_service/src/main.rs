use crate::{api::context::ApiContext, config::AuthInternalAuthSecretKey};
use anyhow::Context;
use config::{Config, Environment};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;

mod api;
mod config;
mod model;
mod service;
mod utils;

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

    let auth_service_key = secretsmanager_client
        .get_maybe_secret_value(env, AuthInternalAuthSecretKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config =
        Config::from_env(auth_service_key).context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 50),
        Environment::Develop => (1, 10),
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

    let redis_client =
        redis::Client::open(config.redis_uri.as_str()).expect("could not connect to redis client");

    match redis_client.get_connection().is_err() {
        true => {
            tracing::error!("unable to connect to redis");
        }
        false => {
            tracing::trace!("initialized redis connection");
        }
    }

    let ses_client = ses_client::Ses::new(
        aws_sdk_sesv2::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ),
        &config.environment.to_string(),
    )
    .invite_email(&config.invite_email);

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let api_context = ApiContext::init(db, redis_client, ses_client, config, jwt_args);

    api::setup_and_serve(api_context).await?;
    Ok(())
}
