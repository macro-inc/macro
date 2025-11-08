use std::sync::Arc;

use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_cache_client::MacroCache;
use macro_env::Environment;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use remote_env_var::LocalOrRemoteSecret;
use roles_and_permissions::{
    domain::service::UserRolesAndPermissionsServiceImpl, outbound::pgpool::MacroDB,
};
use sqlx::PgPool;
use teams::{
    domain::team_service::TeamServiceImpl, outbound::customer_repo::CustomerRepositoryImpl,
    outbound::team_repo::TeamRepositoryImpl,
};

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub auth_client: Arc<crate::service::fusionauth_client::FusionAuthClient>,
    pub macro_cache_client: Arc<MacroCache>,
    pub stripe_client: Arc<stripe::Client>,
    pub comms_client: Arc<comms_service_client::CommsServiceClient>,
    pub document_storage_service_client:
        Arc<document_storage_service_client::DocumentStorageServiceClient>,
    pub notification_service_client: Arc<notification_service_client::NotificationServiceClient>,
    pub ses_client: Arc<ses_client::Ses>,
    pub macro_notify_client: Arc<macro_notify::MacroNotify>,
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

#[derive(Clone)]
pub struct MacroApiTokenContext {
    /// The issuer of the macro-api-token
    pub issuer: MacroApiTokenIssuer,
    /// The macro api token private key used to sign macro-api tokens
    pub macro_api_token_private_key: LocalOrRemoteSecret<MacroApiTokenPrivateSecretKey>,
}

#[derive(Clone)]
pub struct TokenContext {
    /// The access token
    pub access_token: String,
    /// The refresh token
    pub refresh_token: String,
}
