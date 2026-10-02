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

type ToolDescriptionSurfaces = initiative_description::InitiativeDescriptionSurfacesAdapter<
    PgCollabSurfaceService<ToolCollabSurfaceDocumentIds>,
>;

/// Glue giving collab surfaces their view of the document id namespace, which
/// they share in sync-service.
pub struct ToolCollabSurfaceDocumentIds(sqlx::PgPool);

impl collab_surface::domain::ports::DocumentIds for ToolCollabSurfaceDocumentIds {
    #[tracing::instrument(err, skip(self))]
    async fn is_document_id(&self, id: uuid::Uuid) -> Result<bool, rootcause::Report> {
        // Soft-deleted documents keep their session, so the helper counts them.
        macro_db_client::dcs::does_document_exist::does_document_exist(
            self.0.clone(),
            &id.to_string(),
        )
        .await
        .map_err(|e| rootcause::report!("failed to look up document id {id}: {e:?}").into_dynamic())
    }
}

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
            ToolCollabSurfaceDocumentIds(pool.clone()),
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
