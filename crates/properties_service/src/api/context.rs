use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{MacroAuthJwtValidator, MacroAuthorizationServiceImpl};
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;

use properties::PropertiesServiceImpl;
use properties::inbound::axum_router::PropertiesRouterState;

/// The concrete notification ingress service type.
type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

/// Type alias for the entity access service.
pub type EntityAccessServiceType = EntityAccessServiceImpl<PgAccessRepository>;

/// Type alias for the request authorization service.
pub type AuthorizationServiceType = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

/// Type alias for the properties service implementation used throughout the service.
pub type PropertiesService = PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl<EntityAccessServiceType>,
    properties::NotificationServiceImpl<NotificationIngressType>,
>;

/// Minimal state required by properties handlers.
pub type PropertiesHandlerState =
    PropertiesRouterState<PropertiesService, EntityAccessServiceType, AuthorizationServiceType>;
