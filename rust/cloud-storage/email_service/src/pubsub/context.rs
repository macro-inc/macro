use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use document_storage_service_client::DocumentStorageServiceClient;
use gmail_client::GmailClient;
use notification::domain::models::email_notification_digest::StateMachineDriverA;
use notification::domain::service::NotificationIngressService;
use notification::outbound::{
    digest_batcher::RedisDigestBatcher, last_online_checker::LastOnlineCheckerImpl,
    push_notification_checker::PushNotificationCheckerImpl, queue::SqsNotificationQueue,
    repository::DbNotificationRepository, user_existence_checker::DbUserExistenceChecker,
};
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

type StateMachine = StateMachineDriverA<
    DbUserExistenceChecker,
    PushNotificationCheckerImpl<DbNotificationRepository<PgPool>>,
    LastOnlineCheckerImpl<
        last_online_tracker::outbound::time::DefaultTime,
        last_online_tracker::outbound::redis::RedisLastOnlineRepo,
    >,
    RedisDigestBatcher,
>;

/// The concrete notification ingress service type.
pub type NotificationIngressType = NotificationIngressService<
    DbNotificationRepository<PgPool>,
    SqsNotificationQueue,
    StateMachine,
>;

#[derive(Clone)]
pub struct PubSubContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub sqs_client: sqs_client::SQS,
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub sfs_client: StaticFileServiceClient,
    pub connection_gateway_client: ConnectionGatewayClient,
    pub dss_client: DocumentStorageServiceClient,
    pub system_properties_service: Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub notifications_enabled: bool,
    pub retry_worker: bool,
}
