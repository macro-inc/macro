use axum::extract::FromRef;
use entity_access::domain::models::MemberTeamRole;
use entity_access::inbound::axum_extractors::OptionalMacroUserTeamExtractor;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use properties::PropertiesServiceImpl;

/// The concrete notification ingress service type.
type NotificationIngressType = SqsNotificationIngress<SqsQueue>;

/// Type alias for the entity access service.
pub type EntityAccessServiceType = EntityAccessServiceImpl<PgAccessRepository>;

/// Team extractor used by property definition endpoints. Resolves the caller's team
/// membership without failing when they have no team. Member role is required, matching
/// the model where anyone on a team can manage that team's properties.
pub type PropertyTeamExtractor =
    OptionalMacroUserTeamExtractor<MemberTeamRole, EntityAccessServiceType>;

/// The team the caller belongs to, if any. A `None` team scopes the caller to their own
/// user properties.
pub fn caller_team_id(team: &PropertyTeamExtractor) -> Option<Uuid> {
    team.entity_access_receipt
        .as_ref()
        .and_then(|receipt| Uuid::parse_str(&receipt.entity().entity_id).ok())
}

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
