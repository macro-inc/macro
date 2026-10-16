//! The one assembly of the webhooks service, over the host's databases
//! service and entity access.

#[cfg(test)]
mod test;

use std::sync::Arc;

use databases::domain::ports::DatabasesService;
use entity_access::domain::ports::EntityAccessService;
use sqlx::PgPool;

use crate::domain::service::DatabaseWebhooksServiceImpl;
use crate::outbound::databases_tables::DatabasesServiceTables;
use crate::outbound::entity_access_creators::EntityAccessCreators;
use crate::outbound::pg_webhooks_repo::PgWebhooksRepo;

/// The service as every host builds it.
pub type PgDatabaseWebhooksService<Databases, EntityAccess> = DatabaseWebhooksServiceImpl<
    PgWebhooksRepo,
    DatabasesServiceTables<Databases>,
    EntityAccessCreators<EntityAccess>,
>;

/// Build the webhooks service over `pool`, the host's databases service, and
/// its entity access.
pub fn build_service<Databases, EntityAccess>(
    pool: PgPool,
    databases: Arc<Databases>,
    entity_access: Arc<EntityAccess>,
) -> PgDatabaseWebhooksService<Databases, EntityAccess>
where
    Databases: DatabasesService,
    EntityAccess: EntityAccessService,
{
    DatabaseWebhooksServiceImpl::new(
        PgWebhooksRepo::new(pool),
        DatabasesServiceTables::new(databases),
        EntityAccessCreators::new(entity_access),
    )
}
