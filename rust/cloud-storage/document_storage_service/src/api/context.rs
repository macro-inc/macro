use crate::{config::Config, service::s3::S3};
use axum::extract::FromRef;
use comms::{
    domain::service::ChannelServiceImpl,
    inbound::CommsRouterState,
    outbound::{http::user_repo::UserRepoImpl, postgres::comms_repo::PgCommsRepo},
};
use comms_service::CommsHandlerState;
use connection_gateway_client::client::ConnectionGatewayClient;
use dynamodb_client::DynamodbClient;
use email::{domain::service::EmailServiceImpl, outbound::EmailPgRepo};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use macro_sha_count_client::Redis;
use notification::domain::service::NotificationIngressService;
use notification::outbound::{queue::SqsNotificationQueue, repository::DbNotificationRepository};
use opensearch_client::OpensearchClient;
use properties::{
    NotificationServiceImpl, PermissionServiceImpl, PropertiesPgRepo, PropertiesServiceImpl,
};
use properties_service::PropertiesHandlerState;
use search_service::SearchHandlerState;
use secretsmanager_client::LocalOrRemoteSecret;
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
type NotificationIngressType =
    NotificationIngressService<DbNotificationRepository<PgPool>, SqsNotificationQueue>;
type PropertiesService = PropertiesServiceImpl<
    PropertiesPgRepo,
    PermissionServiceImpl,
    NotificationServiceImpl<NotificationIngressType>,
>;

/// Type alias for the ChannelServiceImpl used by comms
pub(crate) type CommsChannelService =
    ChannelServiceImpl<PgCommsRepo, UserRepoImpl, FrecencyPgStorage>;

/// Type alias for the CommsRouterState
pub(crate) type CommsState = CommsRouterState<CommsChannelService>;

#[derive(Clone, FromRef)]
pub(crate) struct ApiContext {
    pub db: PgPool,
    pub redis_client: Arc<Redis>,
    pub s3_client: Arc<S3>,
    pub dynamodb_client: Arc<DynamodbClient>,
    pub dynamo_db: aws_sdk_dynamodb::Client,
    pub soup_router_state: DssSoupState,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub conn_gateway_client: Arc<ConnectionGatewayClient>,
    pub sync_service_client: Arc<SyncServiceClient>,
    pub system_properties_service: Arc<SystemPropertiesService>,
    pub properties_service: Arc<PropertiesService>,
    pub opensearch_client: Arc<OpensearchClient>,
    pub jwt_validation_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub dss_auth_key: DocumentStorageServiceAuthKey,
    // Comms service fields
    pub frecency_storage: FrecencyPgStorage,
    pub comms_state: CommsState,
    pub permissions_token_secret:
        LocalOrRemoteSecret<comms_service::DocumentPermissionJwtSecretKey>,
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

impl From<&ApiContext> for CommsHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        CommsHandlerState {
            jwt_validation_args: ctx.jwt_validation_args.clone(),
            db: ctx.db.clone(),
            connection_gateway_client: ctx.conn_gateway_client.clone(),
            notification_ingress_service: ctx.notification_ingress_service.clone(),
            sqs_client: ctx.sqs_client.clone(),
            permissions_token_secret: ctx.permissions_token_secret.clone(),
            frecency_storage: ctx.frecency_storage.clone(),
            comms_state: ctx.comms_state.clone(),
        }
    }
}

impl FromRef<ApiContext> for CommsHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        CommsHandlerState::from(ctx)
    }
}
