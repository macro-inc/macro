#![recursion_limit = "256"]
mod api;
mod config;

use std::sync::Arc;

use anyhow::Context;
use config::Config;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState,
};
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
    let authorization_service = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(jwt_args),
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
    );
    let authorization_state = MacroAuthorizationState::new(Arc::new(authorization_service));

    let http_client = api::proxy::build_http_client().context("failed to build http client")?;

    let state = api::context::ApiContext {
        authorization_state,
        environment: config.environment,
        http_client,
    };

    api::setup_and_serve(state, config.port).await?;
    Ok(())
}
