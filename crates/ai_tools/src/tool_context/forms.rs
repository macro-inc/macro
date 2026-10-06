//! Forms authoring composition shared by interactive and headless tool hosts.
use super::*;
use ::forms::{
    domain::{authoring::workflow::AuthoringWorkflow, ports::FormEventPublisher},
    outbound::{
        authoring_access::EntityAuthoringAccess,
        authoring_booking::SchedulingTargets,
        authoring_journal::PgAuthoringJournal,
        gateway_event_publisher::{FormPublishError, GatewayFormEventPublisher},
    },
};
use calendar_scheduling::{
    domain::service::Service as SchedulingService,
    outbound::{
        macro_services::{MacroCalendars, MacroDirectory},
        postgres::PostgresRepository,
    },
};
use collab_surface::outbound::{PgCollabSurfaceService, pg_collab_surface_service};

type Calendars = MacroCalendars<ToolCalendarReadService, ToolCalendarMutationService>;
type Directory = MacroDirectory<TeamRepositoryImpl>;
/// Liveness is optional only for hosts without a gateway (including isolated tests).
pub struct ToolFormEvents(Option<GatewayFormEventPublisher>);
impl FormEventPublisher for ToolFormEvents {
    type Error = FormPublishError;
    async fn form_changed(&self, id: ::forms::domain::models::FormId) -> Result<(), Self::Error> {
        if let Some(events) = &self.0 {
            events.form_changed(id).await?;
        }
        Ok(())
    }
}
type Core = ::forms::wiring::PgFormsService<
    ToolDatabasesService,
    ToolEntityAccessService,
    ToolFormEvents,
    MaybeToolEventBroker,
    PgCollabSurfaceService,
>;
/// Production Forms workflow with durable retries and owning-domain validation.
pub type ToolFormsService = AuthoringWorkflow<
    Core,
    ToolDatabasesService,
    PgAuthoringJournal,
    SchedulingTargets<PostgresRepository, Calendars, Directory>,
    EntityAuthoringAccess<ToolEntityAccessService>,
>;
/// Forms tool context for every AI host.
pub type ToolFormsToolContext = ::forms::inbound::toolset::FormsToolContext<ToolFormsService>;

/// Reuse host clients and the same Forms and Scheduling domain services as HTTP.
pub fn build_forms_tool_context(
    pool: sqlx::PgPool,
    documents: &ToolDocumentToolContext,
    databases: &ToolDatabasesToolContext,
    calendars: &ToolCalendarToolContext,
    gateway: Option<ConnectionGatewayClient>,
    broker: MaybeToolEventBroker,
    app_origin: String,
) -> ToolFormsToolContext {
    let surfaces = Arc::new(pg_collab_surface_service(
        pool.clone(),
        documents.lexical_client.as_ref().clone(),
        documents.sync_service_client.as_ref().clone(),
        documents.document_permission_jwt_secret.clone(),
    ));
    let core = Arc::new(::forms::wiring::build_service(
        pool.clone(),
        databases.service.clone(),
        databases.entity_access_service.clone(),
        ToolFormEvents(gateway.map(GatewayFormEventPublisher::new)),
        broker,
        surfaces,
    ));
    let scheduling = Arc::new(SchedulingService::new(
        PostgresRepository::new(pool.clone()),
        MacroCalendars::new(
            calendars.occurrences.clone(),
            calendars.mutations.clone(),
            Some(app_origin.clone()),
        ),
        MacroDirectory(TeamRepositoryImpl::new(pool.clone())),
    ));
    ToolFormsToolContext {
        service: Arc::new(AuthoringWorkflow {
            core,
            databases: databases.service.clone(),
            journal: PgAuthoringJournal::new(pool),
            booking: SchedulingTargets(scheduling),
            access: EntityAuthoringAccess(databases.entity_access_service.clone()),
            app_origin,
        }),
        actor: databases.actor,
    }
}
