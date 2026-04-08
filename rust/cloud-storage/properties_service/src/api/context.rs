use axum::extract::FromRef;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsIngressQueue;
use sqlx::PgPool;
use std::sync::Arc;

use properties::PropertiesServiceImpl;

/// The concrete notification ingress service type.
type NotificationIngressType = SqsNotificationIngress<SqsIngressQueue>;

/// Type alias for the entity access service.
pub type EntityAccessServiceType = EntityAccessServiceImpl<PgAccessRepository>;

/// Type alias for the properties service implementation used throughout the service.
pub type PropertiesService = PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl<EntityAccessServiceType>,
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
    /// The entity access service for permission checks
    pub entity_access_service: Arc<EntityAccessServiceType>,
}
