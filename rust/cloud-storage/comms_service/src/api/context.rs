use axum_macros::FromRef;
use connection_gateway_client::client::ConnectionGatewayClient;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

env_var! {
    #[derive(Clone)]
    pub struct DocumentPermissionJwtSecretKey;
}

#[derive(Clone, FromRef)]
pub struct AppState {
    pub jwt_validation_args: JwtValidationArgs,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub db: PgPool,
    pub connection_gateway_client: Arc<ConnectionGatewayClient>,
    pub macro_notify_client: Arc<macro_notify::MacroNotify>,
    pub document_storage_service_client:
        Arc<document_storage_service_client::DocumentStorageServiceClient>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub auth_service_client: Arc<authentication_service_client::AuthServiceClient>,
    pub permissions_token_secret: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,
    pub frecency_storage: FrecencyPgStorage,
}
