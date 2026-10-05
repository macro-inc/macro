//! The one assembly of the databases service from its Postgres adapters, so
//! every host runs the same SQL; hosts supply entity access, events and broker.

use std::sync::Arc;

use entity_access::domain::ports::{AccessibleDatabases, EntityAccessService};
use macro_event_broker::MacroEventBroker;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;

use crate::domain::ports::TableEventPublisher;
use crate::domain::service::DatabasesServiceImpl;
use crate::outbound::entity_access_directory::EntityAccessDirectory;
use crate::outbound::pg_cell_store::PgCellStore;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;
use crate::outbound::pg_definition_store::PgDefinitionStore;

/// The service as every host builds it.
pub type PgDatabasesService<Events, Broker, EntityAccess> = DatabasesServiceImpl<
    PgDatabasesRepo<PropertiesPgRepo>,
    PgDefinitionStore<PropertiesPgRepo>,
    PgCellStore<PropertiesPgRepo>,
    Events,
    EntityAccessDirectory<EntityAccess>,
    Broker,
>;

/// Build the databases service over `pool` and the host's entity access,
/// publishing table changes through `events` and domain events through `broker`.
pub fn build_service<Events, Broker, EntityAccess>(
    pool: PgPool,
    entity_access: Arc<EntityAccess>,
    events: Events,
    broker: Broker,
) -> PgDatabasesService<Events, Broker, EntityAccess>
where
    Events: TableEventPublisher,
    Broker: MacroEventBroker,
    EntityAccess: EntityAccessService + AccessibleDatabases,
{
    DatabasesServiceImpl::new(
        PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone())),
        PgDefinitionStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone())),
        PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool)),
        events,
        EntityAccessDirectory::new(entity_access),
        broker,
    )
}
