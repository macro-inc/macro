//! The one assembly of the forms service from its Postgres adapters, so
//! every host runs the same SQL; hosts supply the databases service, entity
//! access, the liveness publisher and the broker.

use std::sync::Arc;

use collab_surface::domain::ports::OwnedSurfaceService;
use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::ports::AccessibleForms;
use macro_event_broker::MacroEventBroker;
use sqlx::PgPool;

use crate::domain::ports::FormEventPublisher;
use crate::domain::service::FormsServiceImpl;
use crate::outbound::collaborative_layout::SurfaceFormDrafts;
use crate::outbound::entity_access_directory::EntityAccessFormDirectory;
use crate::outbound::pg_forms_repo::PgFormsRepo;
use crate::outbound::system_clock::SystemClock;

/// The service as every host builds it, over the host's already-built
/// databases service.
pub type PgFormsService<Databases, EntityAccess, Events, Broker, Surfaces> = FormsServiceImpl<
    PgFormsRepo,
    Databases,
    EntityAccessFormDirectory<EntityAccess>,
    Events,
    SystemClock,
    Broker,
    SurfaceFormDrafts<Surfaces>,
>;

/// Build the forms service over `pool`, the host's databases service, its
/// entity access (for the forms catalog), the liveness publisher for open
/// form pages, and the broker for `macro.forms`.
pub fn build_service<Databases, EntityAccess, Events, Broker, Surfaces>(
    pool: PgPool,
    databases: Arc<Databases>,
    entity_access: Arc<EntityAccess>,
    events: Events,
    broker: Broker,
    surfaces: Arc<Surfaces>,
) -> PgFormsService<Databases, EntityAccess, Events, Broker, Surfaces>
where
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    EntityAccess: AccessibleForms,
    Events: FormEventPublisher,
    Broker: MacroEventBroker,
    Surfaces: OwnedSurfaceService,
{
    FormsServiceImpl::new(
        PgFormsRepo::new(pool),
        databases,
        EntityAccessFormDirectory::new(entity_access),
        events,
        SystemClock,
        broker,
        SurfaceFormDrafts::new(surfaces),
    )
}
