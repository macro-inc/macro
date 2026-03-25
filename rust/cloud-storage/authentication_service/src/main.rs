#![recursion_limit = "256"]
use analytics_client::{AnalyticsClient, AnalyticsClientConfig, GoogleAnalyticsConfig, MetaConfig};
use anyhow::Context;
use config::{Config, Environment};
use document_storage_service_client::DocumentStorageServiceClient;
use github::{
    domain::service::{GithubLinkConfig, GithubLinkServiceImpl},
    outbound::{
        github_auth_client::GithubAuthImpl, github_oauth_client::GithubOauthImpl,
        pg_github_repo::PgGithubRepo,
    },
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use native_app_service::{
    domain::{models::PlatformData, service::NativeAppServiceImpl},
    outbound::DefaultBundleFetcher,
};
use notification::outbound::queue::SqsIngressQueue;
use notification::{
    domain::service::SqsNotificationIngress, outbound::rate_limit::RedisRateLimitAdapter,
};
use rate_limit::domain::service::RateLimitServiceImpl;
use roles_and_permissions::{
    domain::service::UserRolesAndPermissionsServiceImpl, outbound::pgpool::MacroDB,
};
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use teams::{
    domain::team_service::TeamServiceImpl,
    outbound::{
        customer_repo::CustomerRepositoryImpl, team_channels_repo::TeamChannelsRepositoryImpl,
        team_repo::TeamRepositoryImpl,
    },
};

use referral::{
    domain::service::ReferralServiceImpl,
    outbound::{pg_referral_repo::PgReferralRepo, stripe_discount_client::StripeDiscountClient},
};

use crate::api::context::{
    ApiContext, MacroApiTokenContext, MacroApiTokenExpirySeconds, MacroApiTokenIssuer,
    MacroApiTokenPrivateSecretKey, StripeWebhookSecretKey,
};
use std::sync::Arc;

mod api;
mod config;
mod generate_password;
mod rate_limit_config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );

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

    let auth_client = fusionauth::FusionAuthClient::new(
        config.fusionauth_tenant_id,
        fusionauth_api_key,
        config.fusionauth_client_id.clone(),
        fusionauth_client_secret,
        config.fusionauth_base_url.clone(),
        config.fusionauth_oauth_redirect_uri.clone(),
        config.google_client_id.clone(),
        google_client_secret,
    );
    tracing::trace!("initialized auth client");

    let document_storage_service_client = DocumentStorageServiceClient::new(
        config.service_internal_auth_key.clone(),
        config.document_storage_service_url.clone(),
    );
    tracing::trace!("initialized document storage service client");

    let macro_cache_client = macro_cache_client::MacroCache::new(config.redis_uri.as_str());

    tracing::trace!("initialized redis client");

    let stripe_client = stripe::Client::new(stripe_client_secret);
    tracing::trace!("initialized stripe client");

    let ses_client = ses_client::Ses::new(
        aws_sdk_sesv2::Client::new(&macro_aws_config::get_macro_aws_config().await),
        &config.environment.to_string(),
    );

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;

    let redis_client =
        redis::Client::open(config.redis_uri.as_str()).context("failed to create redis client")?;
    let redis_multiplexed_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection")?;

    let ingress_queue = SqsIngressQueue {
        client: aws_sdk_sqs::Client::new(&macro_aws_config::get_macro_aws_config().await),
        queue_url: config.notification_queue.clone(),
    };
    let notification_ingress_service = SqsNotificationIngress {
        queue: ingress_queue,
    };
    tracing::trace!("initialized notification ingress service");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(
        &macro_aws_config::get_macro_aws_config().await,
    ))
    .search_event_queue(&config.search_event_queue);
    tracing::trace!("initialized sqs client");

    // Initialize analytics client with configured providers
    let analytics_client = AnalyticsClient::new(AnalyticsClientConfig {
        google_analytics: config
            .ga_measurement_id
            .as_ref()
            .zip(config.ga_api_secret.as_ref())
            .map(|(measurement_id, api_secret)| {
                tracing::info!("configuring Google Analytics");
                GoogleAnalyticsConfig {
                    measurement_id: measurement_id.clone(),
                    api_secret: api_secret.clone(),
                }
            }),
        meta: config
            .meta_pixel_id
            .as_ref()
            .zip(config.meta_access_token.as_ref())
            .map(|(pixel_id, access_token)| {
                tracing::info!("configuring Meta Conversions API");
                MetaConfig {
                    pixel_id: pixel_id.clone(),
                    access_token: access_token.clone(),
                    test_event_code: config.meta_test_event_code.clone(),
                }
            }),
    });
    tracing::trace!("initialized analytics client");

    let user_roles_and_permissions_macro_db = MacroDB::new(db.clone());

    let user_roles_and_permissions_service = UserRolesAndPermissionsServiceImpl::new(
        user_roles_and_permissions_macro_db.clone(),
        user_roles_and_permissions_macro_db,
    );

    let teams_repo_impl = TeamRepositoryImpl::new(db.clone());
    let customer_repo_impl = CustomerRepositoryImpl::new(
        stripe_client.clone(),
        &config.stripe_price_ids.stripe_price_id_haiku,
    );
    let team_channels_repo_impl = TeamChannelsRepositoryImpl::new(db.clone());

    let notification_ingress_service = Arc::new(notification_ingress_service);

    let teams_service_impl = TeamServiceImpl::new(
        teams_repo_impl,
        customer_repo_impl,
        team_channels_repo_impl,
        user_roles_and_permissions_service.clone(),
        notification_ingress_service.clone(),
    );

    let github_link_service_impl = GithubLinkServiceImpl::new(
        PgGithubRepo::new(db.clone()),
        GithubOauthImpl::default(),
        GithubAuthImpl::new(auth_client.clone(), redis_multiplexed_conn),
        GithubLinkConfig {
            client_id: config.github_client_id,
            client_secret: config.github_client_secret,
            idp_id: config.github_idp_id,
        },
    );

    let rate_limit = RateLimitServiceImpl {
        repo: RedisRateLimitAdapter {
            redis: redis_client,
        },
    };
    let referral_service = ReferralServiceImpl {
        repo: PgReferralRepo::new(db.clone()),
        discount_client: StripeDiscountClient::new(
            stripe_client.clone(),
            10000, /*100$ credit, in cents*/
        ),
        notification_ingress: notification_ingress_service.clone(),
    };

    api::setup_and_serve(
        ApiContext {
            db,
            github_link_service: Arc::new(github_link_service_impl),
            auth_client: Arc::new(auth_client),
            macro_cache_client: Arc::new(macro_cache_client),
            stripe_client: Arc::new(stripe_client),
            document_storage_service_client: Arc::new(document_storage_service_client),
            ses_client: Arc::new(ses_client),
            notification_ingress_service,
            sqs_client: Arc::new(sqs_client),
            environment: config.environment,
            rate_limit_service: rate_limit,
            jwt_args,
            token_context: MacroApiTokenContext {
                issuer: MacroApiTokenIssuer::new()?,
                macro_api_token_private_key,
                expiry_seconds: MacroApiTokenExpirySeconds::new()?
                    .as_ref()
                    .parse()
                    .context("failed to parse MACRO_API_TOKEN_EXPIRY_SECONDS as usize")?,
            },
            internal_api_key,
            stripe_webhook_secret,
            user_roles_and_permissions_service: Arc::new(user_roles_and_permissions_service),
            teams_service: Arc::new(teams_service_impl),
            referral_service: Arc::new(referral_service),
            native_app_service: Arc::new(NativeAppServiceImpl {
                bundle_fetcher: DefaultBundleFetcher::default(),
                environment: config.environment,
                platform_data: PlatformData {
                    ios_development_team_id: IOS_DEVELOPMENT_TEAM_ID.to_string(),
                    ios_app_bundle_id: IOS_APP_BUNDLE_ID.to_string(),
                },
            }),
            analytics_client: Arc::new(analytics_client),
            stripe_price_ids: config.stripe_price_ids,
        },
        config.port,
    )
    .await?;
    Ok(())
}

// SAFETY: this is not a secret value
const IOS_DEVELOPMENT_TEAM_ID: &str = "TY74Q77JBD";
// SAFETY: this is not a secret value
const IOS_APP_BUNDLE_ID: &str = "com.macro.app.prod";
