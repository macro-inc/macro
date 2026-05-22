use std::sync::Arc;

use analytics_client::AnalyticsClient;
use axum::extract::FromRef;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use github::domain::service::GithubLinkServiceImpl;
use github::outbound::github_auth_client::GithubAuthImpl;
use github::outbound::github_oauth_client::GithubOauthImpl;
use github::outbound::pg_github_repo::PgGithubRepo;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_cache_client::MacroCache;
use macro_env::Environment;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use native_app_service::{domain::service::NativeAppServiceImpl, outbound::DefaultBundleFetcher};
use notification::outbound::queue::SqsQueue;
use notification::{
    domain::service::SqsNotificationIngress, outbound::rate_limit::RedisRateLimitAdapter,
};
use rate_limit::domain::service::RateLimitServiceImpl;
use referral::{
    domain::service::ReferralServiceImpl,
    outbound::{pg_referral_repo::PgReferralRepo, stripe_discount_client::StripeDiscountClient},
};
use remote_env_var::LocalOrRemoteSecret;
use roles_and_permissions::{
    domain::service::UserRolesAndPermissionsServiceImpl, outbound::pgpool::MacroDB,
};
use sqlx::PgPool;

use crate::config::LegacyStripePriceIds;

pub(crate) type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

pub(crate) type TeamsServiceType = teams::domain::team_service::TeamServiceImpl<
    teams::outbound::team_repo::TeamRepositoryImpl,
    teams::outbound::customer_repo::CustomerRepositoryImpl,
    teams::outbound::team_channels_repo::TeamChannelsRepositoryImpl,
    UserRolesAndPermissionsServiceImpl<MacroDB, MacroDB>,
    NotificationIngressType,
    teams::outbound::crm_enqueuer::SqsCrmEnqueuer,
    teams::outbound::team_crm_settings_repo::TeamCrmSettingsRepositoryImpl,
>;

type RateLimiter = RateLimitServiceImpl<RedisRateLimitAdapter<redis::Client>>;

pub(crate) type ReferralServiceType = ReferralServiceImpl<
    PgReferralRepo,
    StripeDiscountClient,
    Arc<SqsNotificationIngress<SqsQueue>>,
>;

pub(crate) type GithubLinkServiceType =
    GithubLinkServiceImpl<PgGithubRepo, GithubOauthImpl, GithubAuthImpl>;

pub(crate) type EntityAccessServiceType = EntityAccessServiceImpl<PgAccessRepository>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub github_link_service: Arc<GithubLinkServiceType>,
    pub auth_client: Arc<fusionauth::FusionAuthClient>,
    pub macro_cache_client: Arc<MacroCache>,
    pub stripe_client: Arc<stripe::Client>,
    pub document_storage_service_client:
        Arc<document_storage_service_client::DocumentStorageServiceClient>,
    pub ses_client: Arc<ses_client::Ses>,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub environment: Environment,
    pub jwt_args: JwtValidationArgs,
    pub token_context: MacroApiTokenContext,
    pub internal_api_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub stripe_webhook_secret: LocalOrRemoteSecret<StripeWebhookSecretKey>,
    pub user_roles_and_permissions_service:
        Arc<UserRolesAndPermissionsServiceImpl<MacroDB, MacroDB>>, // Note: since FromRef doesn't support generics we have to specify the concrete types here
    pub teams_service: Arc<TeamsServiceType>,
    pub entity_access_service: Arc<EntityAccessServiceType>,
    pub native_app_service: Arc<NativeAppServiceImpl<DefaultBundleFetcher>>,
    pub analytics_client: Arc<AnalyticsClient>,
    pub referral_service: Arc<ReferralServiceType>,
    pub rate_limit_service: RateLimiter,
    /// The stripe price ids
    pub legacy_stripe_price_ids: LegacyStripePriceIds,
    /// The stripe price id
    pub stripe_price_id: String,
}

env_var! {
    #[derive(Clone)]
    pub struct StripeWebhookSecretKey;
}

env_var! {
    #[derive(Clone)]
    pub struct MacroApiTokenIssuer;
}
env_var! {
    #[derive(Clone)]
    pub struct MacroApiTokenPrivateSecretKey;
}

env_var! {
    #[derive(Clone)]
    pub struct MacroApiTokenExpirySeconds;
}

#[derive(Clone)]
pub struct MacroApiTokenContext {
    /// The issuer of the macro-api-token
    pub issuer: MacroApiTokenIssuer,
    /// The macro api token private key used to sign macro-api tokens
    pub macro_api_token_private_key: LocalOrRemoteSecret<MacroApiTokenPrivateSecretKey>,
    /// The token expiry duration in seconds
    pub expiry_seconds: usize,
}

#[derive(Clone)]
pub struct TokenContext {
    /// The access token
    pub access_token: String,
    /// The refresh token
    pub refresh_token: String,
}
