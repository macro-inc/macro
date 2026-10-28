//! Composition of project workflows from owning domain ports and adapters.

use super::*;
use collab_surface::outbound::{PgCollabSurfaceService, pg_collab_surface_service};
use initiative::{
    domain::{
        history::InitiativeHistory, resources::InitiativeResources, service::InitiativeServiceImpl,
    },
    inbound::toolset::InitiativeToolContext,
    outbound::{PgInitiativeRepo, resources::ProjectResources},
};

type ToolDescriptionSurfaces =
    initiative_description::InitiativeDescriptionSurfacesAdapter<PgCollabSurfaceService>;

/// Production initiative service with the same description lifecycle as DSS.
pub type ToolInitiativeService = InitiativeServiceImpl<PgInitiativeRepo, ToolDescriptionSurfaces>;

/// Native project workflow context for every AI/MCP host.
pub type ToolInitiativeToolContext = InitiativeToolContext<
    ToolInitiativeService,
    ToolEntityAccessService,
    activity::outbound::pg_activity_repo::PgActivityRepo,
>;

/// Compose project lifecycle tools with description surfaces and activity publication.
pub fn build_initiative_tool_context(
    pool: sqlx::PgPool,
    documents: &ToolDocumentToolContext,
    properties: Arc<ToolPropertiesService>,
    access: Arc<ToolEntityAccessService>,
    event_broker: ToolEventBroker,
) -> ToolInitiativeToolContext {
    let surfaces = initiative_description::InitiativeDescriptionSurfacesAdapter::new(Arc::new(
        pg_collab_surface_service(
            pool.clone(),
            documents.lexical_client.as_ref().clone(),
            documents.sync_service_client.as_ref().clone(),
            documents.document_permission_jwt_secret.clone(),
        ),
    ));
    let resources: Arc<dyn InitiativeResources> = Arc::new(ProjectResources::new(
        properties,
        Arc::new(SystemPropertiesServiceImpl::new(
            PgSystemPropertiesRepository::new(pool.clone()),
        )),
        access.clone(),
    ));
    let service = InitiativeServiceImpl::new(
        PgInitiativeRepo::new(pool.clone()),
        surfaces,
        resources.clone(),
    )
    .with_event_publisher(Arc::new(
        initiative::outbound::event_publisher::BrokerInitiativeEventPublisher::new(
            event_broker.clone(),
        ),
    ));
    InitiativeToolContext {
        service: Arc::new(service),
        access: access.clone(),
        history: Arc::new(InitiativeHistory::new(
            activity::outbound::pg_activity_repo::PgActivityRepo::new(pool.clone()),
            access.clone(),
        )),
        resources,
        actor: bot_id::MACRO_AI_BOT_ID,
    }
}
