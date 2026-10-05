//! The one assembly of the forms service from its Postgres adapters, so
//! every host runs the same SQL; hosts supply the databases service, entity
//! access, the liveness publisher and the broker.

use std::sync::Arc;

use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::ports::AccessibleForms;
use macro_event_broker::MacroEventBroker;
use sqlx::PgPool;

use crate::domain::ports::FormEventPublisher;
use crate::domain::service::FormsServiceImpl;
use crate::outbound::entity_access_directory::EntityAccessFormDirectory;
use crate::outbound::pg_forms_repo::PgFormsRepo;
use crate::outbound::system_clock::SystemClock;

/// The service as every host builds it, over the host's already-built
/// databases service.
pub type PgFormsService<Databases, EntityAccess, Events, Broker> = FormsServiceImpl<
    PgFormsRepo,
    Databases,
    EntityAccessFormDirectory<EntityAccess>,
    Events,
    SystemClock,
    Broker,
>;

/// Build the forms service over `pool`, the host's databases service, its
/// entity access (for the forms catalog), the liveness publisher for open
/// form pages, and the broker for `macro.forms`.
pub fn build_service<Databases, EntityAccess, Events, Broker>(
    pool: PgPool,
    databases: Arc<Databases>,
    entity_access: Arc<EntityAccess>,
    events: Events,
    broker: Broker,
) -> PgFormsService<Databases, EntityAccess, Events, Broker>
where
    Databases: DatabasesService + DatabaseRowReads,
    EntityAccess: AccessibleForms,
    Events: FormEventPublisher,
    Broker: MacroEventBroker,
{
    FormsServiceImpl::new(
        PgFormsRepo::new(pool),
        databases,
        EntityAccessFormDirectory::new(entity_access),
        events,
        SystemClock,
        broker,
    )
}
