#![recursion_limit = "256"]
mod api;
mod config;

use anyhow::Context;
use config::Config;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env().context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let http_client = reqwest::Client::new();

    let state = api::context::ApiContext {
        jwt_args,
        environment: config.environment,
        http_client,
    };

    api::setup_and_serve(state, config.port).await?;
    Ok(())
}
