use anyhow::Context;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::SecretManager;

mod api;
mod config;
mod model;
mod service;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = config::Config::from_env().context("missing environment variables")?;

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

    let jwt_validation_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    api::setup_and_serve(config, jwt_validation_args, internal_api_secret).await?;
    Ok(())
}
