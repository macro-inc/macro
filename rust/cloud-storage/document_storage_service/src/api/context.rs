use crate::{TempNoopEmailService, config::Config, service::s3::S3};
use axum::extract::FromRef;
use connection_gateway_client::client::ConnectionGatewayClient;
use dynamodb_client::DynamodbClient;
use email_service_client::EmailServiceClient;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use macro_redis_cluster_client::Redis;
use soup::{
    domain::service::SoupImpl, inbound::axum_router::SoupRouterState,
    outbound::pg_soup_repo::PgSoupRepo,
};
use sqlx::PgPool;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

#[derive(Debug, Clone)]
pub struct InternalFlag {
    pub internal: bool,
}

type DssSoupState = SoupRouterState<
    SoupImpl<PgSoupRepo, FrecencyQueryServiceImpl<FrecencyPgStorage>, TempNoopEmailService>,
>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub redis_client: Arc<Redis>,
    pub s3_client: Arc<S3>,
    pub dynamodb_client: Arc<DynamodbClient>,
    pub dynamo_db: aws_sdk_dynamodb::Client,
    pub soup_router_state: DssSoupState,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub macro_notify_client: Arc<macro_notify::MacroNotify>,
    pub comms_service_client: Arc<comms_service_client::CommsServiceClient>,
    pub email_service_client: Arc<EmailServiceClient>,
    pub conn_gateway_client: Arc<ConnectionGatewayClient>,
    pub sync_service_client: Arc<SyncServiceClient>,
    pub jwt_validation_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub dss_auth_key: DocumentStorageServiceAuthKey,
}

env_var! {
    #[derive(Clone)]
    pub struct DocumentStorageServiceAuthKey;
}
