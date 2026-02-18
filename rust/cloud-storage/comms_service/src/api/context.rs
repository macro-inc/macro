use axum_macros::FromRef;
use comms::{
    domain::service::ChannelServiceImpl,
    inbound::CommsRouterState,
    outbound::{http::user_repo::UserRepoImpl, postgres::comms_repo::PgCommsRepo},
};
use connection_gateway_client::client::ConnectionGatewayClient;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use notification_hex::domain::models::email_notification_digest::StateMachineDriverA;
use notification_hex::domain::service::NotificationIngressService;
use notification_hex::outbound::{
    digest_batcher::RedisDigestBatcher, last_online_checker::LastOnlineCheckerImpl,
    push_notification_checker::PushNotificationCheckerImpl, queue::SqsNotificationQueue,
    repository::DbNotificationRepository, user_existence_checker::DbUserExistenceChecker,
};
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

type StateMachine = StateMachineDriverA<
    DbUserExistenceChecker,
    PushNotificationCheckerImpl<DbNotificationRepository<PgPool>>,
    LastOnlineCheckerImpl<
        last_online_tracker::outbound::time::DefaultTime,
        last_online_tracker::outbound::redis::RedisLastOnlineRepo,
    >,
    RedisDigestBatcher,
>;

pub type NotificationIngressType = NotificationIngressService<
    DbNotificationRepository<PgPool>,
    SqsNotificationQueue,
    StateMachine,
>;

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
}

pub type ChannelImpl = ChannelServiceImpl<PgCommsRepo, UserRepoImpl, FrecencyPgStorage>;
