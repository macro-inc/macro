use axum::extract::FromRef;
use notification::domain::models::email_notification_digest::StateMachineDriverA;
use notification::domain::service::NotificationIngressService;
use notification::outbound::{
    digest_batcher::RedisDigestBatcher, last_online_checker::LastOnlineCheckerImpl,
    push_notification_checker::PushNotificationCheckerImpl, queue::SqsNotificationQueue,
    repository::DbNotificationRepository, user_existence_checker::DbUserExistenceChecker,
};
use sqlx::PgPool;
use std::sync::Arc;

use properties::PropertiesServiceImpl;

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
type NotificationIngressType = NotificationIngressService<
    DbNotificationRepository<PgPool>,
    SqsNotificationQueue,
    StateMachine,
>;

/// Type alias for the properties service implementation used throughout the service.
pub type PropertiesService = PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl,
    properties::NotificationServiceImpl<NotificationIngressType>,
>;

/// Minimal state required by properties handlers.
/// This can be extracted from any state that implements `FromRef<PropertiesHandlerState>`.
#[derive(Clone, FromRef)]
pub struct PropertiesHandlerState {
    /// Macrodb database connection (contains properties tables and permission tables)
    pub db: PgPool,
    /// The properties service implementation
    pub properties_service: Arc<PropertiesService>,
}
