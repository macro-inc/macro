#![recursion_limit = "256"]
use anyhow::Context;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;

mod api;
mod config;
mod model;
mod service;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = config::Config::from_env().context("missing environment variables")?;

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let environment = config.environment;
    let config = config
        .resolve_remote_secrets(environment, &secretsmanager_client)
        .await
        .context("failed to resolve config secrets")?;
    let internal_api_secret = config.internal_api_secret_key.clone();

    let jwt_validation_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    api::setup_and_serve(config, jwt_validation_args, internal_api_secret).await?;
    Ok(())
}
