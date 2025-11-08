use crate::{config::Config, util::redis::RedisClient};
use axum::extract::FromRef;
use document_storage_service_client::DocumentStorageServiceClient;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: sqlx::Pool<sqlx::Postgres>,
    pub auth_service_client: Arc<authentication_service_client::AuthServiceClient>,
    pub gmail_client: Arc<gmail_client::GmailClient>,
    pub redis_client: Arc<RedisClient>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub s3_client: Arc<s3_client::S3>,
    pub sfs_client: Arc<StaticFileServiceClient>,
    pub dss_client: Arc<DocumentStorageServiceClient>,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub frecency_storage: FrecencyPgStorage,
}
