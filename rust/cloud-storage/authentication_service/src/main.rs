#![recursion_limit = "256"]
use analytics_client::{
    AnalyticsClient, AnalyticsClientConfig, GoogleAnalyticsConfig, MetaConfig, PostHogConfig,
};
use anyhow::{Context, anyhow};
use config::{Config, Environment};
use document_storage_service_client::DocumentStorageServiceClient;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use foreign_entity::{
    domain::service::ForeignEntityServiceImpl,
    outbound::pg_foreign_entity_repo::PgForeignEntityRepo,
};
use github::{
    domain::service::{GithubLinkConfig, GithubLinkServiceImpl},
    outbound::{
        github_auth_client::GithubAuthImpl, github_oauth_client::GithubOauthImpl,
        pg_github_repo::PgGithubRepo,
    },
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_service_urls::AppServiceUrl;
use macro_service_urls::DocumentStorageServiceUrl;
use native_app_service::{
    domain::{models::PlatformData, service::NativeAppServiceImpl},
    outbound::DefaultBundleFetcher,
};
use notification::outbound::queue::SqsQueue;
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
use std::{sync::Arc, time::Instant};

mod api;
mod config;
mod generate_password;
mod rate_limit_config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let startup_started = Instant::now();
    let mut previous_step = startup_started;
    let env = Environment::new_or_prod();

    // One SDK config is sufficient for every AWS client in this process. Apart
    // from avoiding repeated provider-chain work, the timings below make any
    // slow local/preview endpoint discovery visible in the Fly deploy log.
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    startup_step(startup_started, &mut previous_step, "load AWS SDK config");
    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;
    startup_step(
        startup_started,
        &mut previous_step,
        "load environment config",
    );

    let internal_api_key = config.internal_api_key.clone();

    let stripe_webhook_secret = secretsmanager_client
        .get_maybe_secret_value(env, StripeWebhookSecretKey::new()?)
        .await?;
    startup_step(
        startup_started,
        &mut previous_step,
        "load Stripe webhook secret",
    );

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
    startup_step(startup_started, &mut previous_step, "connect to Postgres");

    tracing::trace!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    // Macro API token
    let macro_api_token_private_key = secretsmanager_client
        .get_maybe_secret_value(config.environment, MacroApiTokenPrivateSecretKey::new()?)
        .await?;
    startup_step(
        startup_started,
        &mut previous_step,
        "load Macro API token key",
    );

    let fusionauth_api_key = match config.environment {
        Environment::Local => config.fusionauth_api_key_secret_key.to_string().clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.fusionauth_api_key_secret_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let fusionauth_client_secret = match config.environment {
        Environment::Local => config.fusionauth_client_secret_key.to_string().clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.fusionauth_client_secret_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let stripe_client_secret = match config.environment {
        Environment::Local => config.stripe_secret_key.to_string().clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.stripe_secret_key)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let google_client_secret = match config.environment {
        Environment::Local => config.google_client_secret_key.to_string().clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.google_client_secret_key)
            .await
            .context("unable to get google client secret")?
            .to_string(),
    };
    startup_step(
        startup_started,
        &mut previous_step,
        "load auth provider secrets",
    );

    let auth_client = fusionauth::FusionAuthClient::new(
        config.fusionauth_tenant_id.to_string(),
        fusionauth_api_key,
        config.fusionauth_client_id.to_string().clone(),
        fusionauth_client_secret,
        config.fusionauth_base_url.to_string().clone(),
        config.fusionauth_oauth_redirect_uri.to_string().clone(),
        config.google_client_id.to_string().clone(),
        google_client_secret,
    );
    tracing::trace!("initialized auth client");

    let document_storage_service_client = DocumentStorageServiceClient::new(
        config.service_internal_auth_key.to_string().clone(),
        DocumentStorageServiceUrl::new()?.to_string(),
    );
    tracing::trace!("initialized document storage service client");

    let macro_cache_client =
        macro_cache_client::MacroCache::new(config.redis_uri.to_string().as_str());

    tracing::trace!("initialized redis client");

    let stripe_client = stripe::Client::new(stripe_client_secret);
    tracing::trace!("initialized stripe client");

    // `from_env` routes to local SMTP (Mailpit) when SMTP_HOST is set, else SES.
    let ses_client = ses_client::Ses::from_env(
        aws_sdk_sesv2::Client::new(&aws_config),
        &config.environment.to_string(),
    );

    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secretsmanager_client)
            .await?;
    startup_step(
        startup_started,
        &mut previous_step,
        "initialize JWT validation",
    );

    let redis_client = redis::Client::open(config.redis_uri.to_string().as_str())
        .context("failed to create redis client")?;
    let redis_multiplexed_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection")?;
    startup_step(startup_started, &mut previous_step, "connect to Redis");

    let notification_queue = macro_queues::NotificationIngressQueue::new();
    let search_event_queue = macro_queues::SearchEventQueue::new();
    let link_manager_queue = macro_queues::LinkManagerQueue::new();
    let email_backfill_queue = macro_queues::EmailBackfillQueue::new();
    let ingress_queue = SqsQueue::new(
        aws_sdk_sqs::Client::new(&macro_aws_config::get_macro_aws_config().await),
        notification_queue.to_string(),
    );
    let notification_ingress_service = SqsNotificationIngress {
        queue: ingress_queue,
    };
    tracing::trace!("initialized notification ingress service");

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .search_event_queue(&search_event_queue)
        .email_link_manager_queue(&link_manager_queue)
        .email_backfill_queue(&email_backfill_queue);
    tracing::trace!("initialized sqs client");

    // Initialize analytics client with configured providers
    let analytics_client = AnalyticsClient::new(AnalyticsClientConfig {
        google_analytics: config
            .ga_measurement_id
            .value()
            .zip(config.ga_api_secret.value())
            .map(|(measurement_id, api_secret)| {
                tracing::info!("configuring Google Analytics");
                GoogleAnalyticsConfig {
                    measurement_id: measurement_id.to_string(),
                    api_secret: api_secret.to_string(),
                }
            }),
        meta: config
            .meta_pixel_id
            .value()
            .zip(config.meta_access_token.value())
            .map(|(pixel_id, access_token)| {
                tracing::info!("configuring Meta Conversions API");
                MetaConfig {
                    pixel_id: pixel_id.to_string(),
                    access_token: access_token.to_string(),
                    test_event_code: config.meta_test_event_code.value().map(str::to_string),
                }
            }),
        posthog: config.posthog_api_key.value().map(|api_key| {
            tracing::info!("configuring PostHog");
            PostHogConfig {
                api_key: api_key.to_string(),
                host: config
                    .posthog_host
                    .value()
                    .map(str::to_string)
                    .unwrap_or_else(|| "https://us.i.posthog.com".to_string()),
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
        config.stripe_price_id.to_string().clone(),
    );
    let team_channels_repo_impl = TeamChannelsRepositoryImpl::new(db.clone());
    let team_crm_settings_repo_impl =
        teams::outbound::team_crm_settings_repo::TeamCrmSettingsRepositoryImpl::new(db.clone());

    let notification_ingress_service = Arc::new(notification_ingress_service);

    let crm_enqueuer = teams::outbound::crm_enqueuer::SqsCrmEnqueuer::new(sqs_client.clone());

    let teams_service_impl = TeamServiceImpl::new(
        teams_repo_impl,
        customer_repo_impl,
        team_channels_repo_impl,
        user_roles_and_permissions_service.clone(),
        notification_ingress_service.clone(),
        crm_enqueuer,
        team_crm_settings_repo_impl,
    );

    let foreign_entity_service =
        ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(db.clone()));

    let github_link_service_impl = GithubLinkServiceImpl::new(
        PgGithubRepo::new(db.clone()),
        GithubOauthImpl::default(),
        GithubAuthImpl::new(auth_client.clone(), redis_multiplexed_conn),
        foreign_entity_service,
        GithubLinkConfig {
            client_id: config.github_client_id.to_string(),
            client_secret: config.github_client_secret.to_string(),
            idp_id: config.github_idp_id.to_string(),
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

    let entity_access_service_impl =
        EntityAccessServiceImpl::new(PgAccessRepository::new(db.clone()));

    startup_step(
        startup_started,
        &mut previous_step,
        "assemble service dependencies",
    );

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
            entity_access_service: Arc::new(entity_access_service_impl),
            referral_service: Arc::new(referral_service),
            native_app_service: Arc::new(NativeAppServiceImpl {
                bundle_fetcher: DefaultBundleFetcher::new(
                    AppServiceUrl::new_for_environment(config.environment)
                        .context("failed to resolve app service URL")?
                        .parse_url()
                        .context("failed to parse app service URL")?,
                ),
                bundle_policy: native_app_service::domain::models::BundleUpdatePolicy::from_env()
                    .map_err(|err| {
                    anyhow!("failed to load bundle update policy: {err}")
                })?,
                platform_data: PlatformData {
                    ios_development_team_id: IOS_DEVELOPMENT_TEAM_ID.to_string(),
                    ios_app_bundle_id: IOS_APP_BUNDLE_ID.to_string(),
                },
            }),
            analytics_client: Arc::new(analytics_client),
            stripe_price_id: config.stripe_price_id.to_string(),
        },
        config.port,
    )
    .await?;
    Ok(())
}

fn startup_step(startup_started: Instant, previous_step: &mut Instant, step: &'static str) {
    let now = Instant::now();
    tracing::info!(
        step,
        elapsed_ms = now.duration_since(*previous_step).as_millis() as u64,
        total_ms = now.duration_since(startup_started).as_millis() as u64,
        "authentication startup step"
    );
    *previous_step = now;
}

// SAFETY: this is not a secret value
const IOS_DEVELOPMENT_TEAM_ID: &str = "TY74Q77JBD";
// SAFETY: this is not a secret value
const IOS_APP_BUNDLE_ID: &str = "com.macro.app.prod";
