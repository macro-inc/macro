use anyhow::Context;
use comms_service_client::CommsServiceClient;
use config::{Config, Environment};
use document_storage_service_client::DocumentStorageServiceClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification_service_client::NotificationServiceClient;
use roles_and_permissions::{
    domain::service::UserRolesAndPermissionsServiceImpl, outbound::pgpool::MacroDB,
};
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use teams::{
    domain::team_service::TeamServiceImpl,
    outbound::{customer_repo::CustomerRepositoryImpl, team_repo::TeamRepositoryImpl},
};

use crate::api::context::{
    ApiContext, MacroApiTokenContext, MacroApiTokenIssuer, MacroApiTokenPrivateSecretKey,
    StripeWebhookSecretKey,
};
use std::sync::Arc;

mod api;
mod config;
mod generate_password;
mod rate_limit_config;
mod service;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let secretsmanager_client =
        secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ));

    let internal_api_key = secretsmanager_client
        .get_maybe_secret_value(env, InternalApiSecretKey::new()?)
        .await?;

    let stripe_webhook_secret = secretsmanager_client
        .get_maybe_secret_value(env, StripeWebhookSecretKey::new()?)
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

    // Macro API token
    let macro_api_token_private_key = secretsmanager_client
        .get_maybe_secret_value(config.environment, MacroApiTokenPrivateSecretKey::new()?)
        .await?;

    let fusionauth_api_key = match config.environment {
        Environment::Local => config.fusionauth_api_key_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.fusionauth_api_key_secret_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let fusionauth_client_secret = match config.environment {
        Environment::Local => config.fusionauth_client_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.fusionauth_client_secret_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let stripe_client_secret = match config.environment {
        Environment::Local => config.stripe_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.stripe_secret_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let google_client_secret = match config.environment {
        Environment::Local => config.google_client_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.google_client_secret_key)
            .await
            .context("unable to get google client secret")?
            .to_string(),
    };

    let auth_client = crate::service::fusionauth_client::FusionAuthClient::new(
        fusionauth_api_key,
        config.fusionauth_client_id.clone(),
        fusionauth_client_secret,
        config.fusionauth_application_id.clone(),
        config.fusionauth_base_url.clone(),
        config.fusionauth_oauth_redirect_uri.clone(),
        config.google_client_id.clone(),
        google_client_secret,
    );
    tracing::trace!("initialized auth client");

    let comms_client = CommsServiceClient::new(
        config.service_internal_auth_key.clone(),
        config.comms_service_url.clone(),
    );
    tracing::trace!("initialized comms client");

    let document_storage_service_client = DocumentStorageServiceClient::new(
        config.service_internal_auth_key.clone(),
        config.document_storage_service_url.clone(),
    );
    tracing::trace!("initialized document storage service client");

    let notification_service_client = NotificationServiceClient::new(
        config.service_internal_auth_key.clone(),
        config.notification_service_url.clone(),
    );

    let macro_cache_client = macro_cache_client::MacroCache::new(config.redis_uri.as_str());

    tracing::trace!("initialized redis client");

    let stripe_client = stripe::Client::new(stripe_client_secret);
    tracing::trace!("initialized stripe client");

    let ses_client = ses_client::Ses::new(
        aws_sdk_sesv2::Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        ),
        &config.environment.to_string(),
    );

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let macro_notify_client = macro_notify::MacroNotify::new(
        config.notification_queue.clone(),
        "authentication_service".to_string(),
    )
    .await;
    tracing::trace!("initialized macro_notify client");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region("us-east-1")
            .load()
            .await,
    ))
    .search_event_queue(&config.search_event_queue);
    tracing::trace!("initialized sqs client");

    let user_roles_and_permissions_macro_db = MacroDB::new(db.clone());

    let user_roles_and_permissions_service = UserRolesAndPermissionsServiceImpl::new(
        user_roles_and_permissions_macro_db.clone(),
        user_roles_and_permissions_macro_db,
    );

    let teams_repo_impl = TeamRepositoryImpl::new(db.clone());
    let customer_repo_impl = CustomerRepositoryImpl::new(stripe_client.clone());

    let teams_service_impl = TeamServiceImpl::new(
        teams_repo_impl,
        customer_repo_impl,
        user_roles_and_permissions_service.clone(),
    );

    api::setup_and_serve(
        ApiContext {
            db,
            auth_client: Arc::new(auth_client),
            macro_cache_client: Arc::new(macro_cache_client),
            stripe_client: Arc::new(stripe_client),
            comms_client: Arc::new(comms_client),
            document_storage_service_client: Arc::new(document_storage_service_client),
            notification_service_client: Arc::new(notification_service_client),
            ses_client: Arc::new(ses_client),
            macro_notify_client: Arc::new(macro_notify_client),
            sqs_client: Arc::new(sqs_client),
            environment: config.environment,
            jwt_args,
            token_context: MacroApiTokenContext {
                issuer: MacroApiTokenIssuer::new()?,
                macro_api_token_private_key,
            },
            internal_api_key,
            stripe_webhook_secret,
            user_roles_and_permissions_service: Arc::new(user_roles_and_permissions_service),
            teams_service: Arc::new(teams_service_impl),
        },
        config.port,
    )
    .await?;
    Ok(())
}
