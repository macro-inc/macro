use axum_macros::FromRef;
use comms::{
    domain::service::ChannelServiceImpl,
    inbound::CommsRouterState,
    outbound::postgres::{comms_repo::PgCommsRepo, user_repo::PgUserRepo},
};
use connection_gateway_client::client::ConnectionGatewayClient;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use notification_hex::domain::service::SqsNotificationIngress;
use notification_hex::outbound::queue::SqsIngressQueue;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

pub type NotificationIngressType = SqsNotificationIngress<SqsIngressQueue>;
pub type EntityAccessServiceType = EntityAccessServiceImpl<PgAccessRepository>;

env_var! {
    #[derive(Clone)]
    pub struct DocumentPermissionJwtSecretKey;
}

#[derive(Clone, FromRef)]
pub struct AppState {
    pub jwt_validation_args: JwtValidationArgs,
    pub db: PgPool,
    pub connection_gateway_client: Arc<ConnectionGatewayClient>,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub permissions_token_secret: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,
    pub frecency_storage: FrecencyPgStorage,
    pub comms_state: CommsRouterState<ChannelImpl>,
    pub entity_access_service: Arc<EntityAccessServiceType>,
}

pub type ChannelImpl = ChannelServiceImpl<PgCommsRepo, PgUserRepo, FrecencyPgStorage>;
