use crate::config::Config;
use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use opensearch_client::OpensearchClient;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub opensearch_client: Arc<OpensearchClient>,
    pub comms_service_client: Arc<comms_service_client::CommsServiceClient>,
    pub dss_client: Arc<document_storage_service_client::DocumentStorageServiceClient>,
    pub email_service_client: Arc<email_service_client::EmailServiceClient>,
    pub jwt_args: JwtValidationArgs,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub config: Arc<Config>,
}
