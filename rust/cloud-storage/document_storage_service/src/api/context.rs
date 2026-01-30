use crate::{config::Config, service::s3::S3};
use axum::extract::FromRef;
use comms::{
    domain::service::ChannelServiceImpl,
    outbound::{http::user_repo::UserRepoImpl, postgres::comms_repo::PgCommsRepo},
};
use connection_gateway_client::client::ConnectionGatewayClient;
use dynamodb_client::DynamodbClient;
use email::{domain::service::EmailServiceImpl, outbound::EmailPgRepo};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use macro_redis_cluster_client::Redis;
use opensearch_client::OpensearchClient;
use properties::{
    NotificationServiceImpl, PermissionServiceImpl, PropertiesPgRepo, PropertiesServiceImpl,
};
use properties_service::PropertiesHandlerState;
use search_service::SearchHandlerState;
use soup::{
    domain::service::SoupImpl, inbound::axum_router::SoupRouterState,
    outbound::pg_soup_repo::PgSoupRepo,
};
use sqlx::PgPool;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

#[derive(Debug, Clone)]
pub struct InternalFlag {
    pub internal: bool,
}

type DssSoupState = SoupRouterState<
    SoupImpl<
        PgSoupRepo,
        FrecencyQueryServiceImpl<FrecencyPgStorage>,
        EmailServiceImpl<EmailPgRepo, FrecencyQueryServiceImpl<FrecencyPgStorage>>,
        ChannelServiceImpl<PgCommsRepo, UserRepoImpl, FrecencyPgStorage>,
    >,
    EmailServiceImpl<EmailPgRepo, FrecencyQueryServiceImpl<FrecencyPgStorage>>,
>;

type SystemPropertiesService = SystemPropertiesServiceImpl<PgSystemPropertiesRepository>;
type PropertiesService =
    PropertiesServiceImpl<PropertiesPgRepo, PermissionServiceImpl, NotificationServiceImpl>;

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
    pub conn_gateway_client: Arc<ConnectionGatewayClient>,
    pub sync_service_client: Arc<SyncServiceClient>,
    pub system_properties_service: Arc<SystemPropertiesService>,
    pub properties_service: Arc<PropertiesService>,
    pub opensearch_client: Arc<OpensearchClient>,
    pub jwt_validation_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub dss_auth_key: DocumentStorageServiceAuthKey,
}

env_var! {
    #[derive(Clone)]
    pub struct DocumentStorageServiceAuthKey;
}

impl From<&ApiContext> for PropertiesHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        PropertiesHandlerState {
            db: ctx.db.clone(),
            properties_service: ctx.properties_service.clone(),
        }
    }
}

impl FromRef<ApiContext> for PropertiesHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        PropertiesHandlerState::from(ctx)
    }
}

impl From<&ApiContext> for SearchHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        SearchHandlerState {
            db: ctx.db.clone(),
            opensearch_client: ctx.opensearch_client.clone(),
        }
    }
}

impl FromRef<ApiContext> for SearchHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        SearchHandlerState::from(ctx)
    }
}
