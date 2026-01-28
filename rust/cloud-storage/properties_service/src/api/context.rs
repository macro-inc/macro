use axum::extract::FromRef;
use notification::outbound::queue::SqsNotificationQueue;
use notification::outbound::repository::DbNotificationRepository;
use sqlx::PgPool;
use std::sync::Arc;

use properties::PropertiesServiceImpl;

/// Type alias for the NotificationServiceImpl with concrete types.
pub type NotificationServiceType =
    properties::NotificationServiceImpl<DbNotificationRepository<PgPool>, SqsNotificationQueue>;

/// Type alias for the properties service implementation used throughout the service.
pub type PropertiesService = PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl,
    NotificationServiceType,
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
