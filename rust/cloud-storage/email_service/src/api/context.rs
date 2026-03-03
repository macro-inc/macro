use axum::extract::FromRef;
use document_storage_service_client::DocumentStorageServiceClient;
use email::{
    domain::service::EmailServiceImpl,
    inbound::{EmailRouterState, EmailThreadRouterState},
    outbound::EmailPgRepo,
};
use email_service::config::Config;
use email_service::util::redis::RedisClient;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

pub(crate) type EmailEntityAccessService = EntityAccessServiceImpl<PgAccessRepository>;
type EmailSvc =
    EmailServiceImpl<EmailPgRepo, FrecencyQueryServiceImpl<FrecencyPgStorage>, sqs_client::SQS>;

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
    pub system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub email_service: EmailRouterState<EmailSvc>,
    pub entity_access_service: Arc<EmailEntityAccessService>,
    pub email_thread_state: EmailThreadRouterState<EmailSvc, EmailEntityAccessService>,
}
