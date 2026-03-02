use std::sync::Arc;

use axum::extract::FromRef;
use github::domain::service::GithubServiceImpl;
use github::outbound::github_auth_client::GithubAuthImpl;
use github::outbound::github_oauth_client::GithubOauthImpl;
use github::outbound::pg_github_repo::PgGithubRepo;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_cache_client::MacroCache;
use macro_env::Environment;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use native_app_service::{domain::service::NativeAppServiceImpl, outbound::DefaultBundleFetcher};
use notification::domain::models::email_notification_digest::StateMachineDriverA;
use notification::domain::service::NotificationIngressService;
use notification::outbound::{
    digest_batcher::RedisDigestBatcher, last_online_checker::LastOnlineCheckerImpl,
    push_notification_checker::PushNotificationCheckerImpl, queue::SqsNotificationQueue,
    repository::DbNotificationRepository, user_existence_checker::DbUserExistenceChecker,
};
use remote_env_var::LocalOrRemoteSecret;
use roles_and_permissions::{
    domain::service::UserRolesAndPermissionsServiceImpl, outbound::pgpool::MacroDB,
};
use sqlx::PgPool;
use teams::{
    domain::team_service::TeamServiceImpl, outbound::customer_repo::CustomerRepositoryImpl,
    outbound::team_repo::TeamRepositoryImpl,
};

type StateMachine = StateMachineDriverA<
    DbUserExistenceChecker,
    PushNotificationCheckerImpl<DbNotificationRepository<PgPool>>,
    LastOnlineCheckerImpl<
        last_online_tracker::outbound::time::DefaultTime,
        last_online_tracker::outbound::redis::RedisLastOnlineRepo,
    >,
    RedisDigestBatcher,
>;

pub(crate) type NotificationIngressType = NotificationIngressService<
    DbNotificationRepository<PgPool>,
    SqsNotificationQueue,
    StateMachine,
>;

pub(crate) type GithubServiceType =
    GithubServiceImpl<PgGithubRepo, GithubOauthImpl, GithubAuthImpl>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub github_service: Arc<GithubServiceType>,
    pub auth_client: Arc<fusionauth::FusionAuthClient>,
    pub macro_cache_client: Arc<MacroCache>,
    pub stripe_client: Arc<stripe::Client>,
    pub document_storage_service_client:
        Arc<document_storage_service_client::DocumentStorageServiceClient>,
    pub notification_service_client: Arc<notification_service_client::NotificationServiceClient>,
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
    pub teams_service: Arc<
        TeamServiceImpl<
            TeamRepositoryImpl,
            CustomerRepositoryImpl,
            UserRolesAndPermissionsServiceImpl<MacroDB, MacroDB>,
        >,
    >,
    pub native_app_service: Arc<NativeAppServiceImpl<DefaultBundleFetcher>>,
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
