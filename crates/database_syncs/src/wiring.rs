//! The one assembly of the syncs service, over the host's databases
//! service, entity access, call import, Granola accounts, Notion connections
//! and teams.

#[cfg(test)]
mod test;

use std::sync::Arc;

use call::domain::imports::CallImportService;
use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use databases::outbound::entity_access_creators::EntityAccessCreators;
use entity_access::domain::ports::EntityAccessService;
use granola_sync::domain::ports::Accounts;
use import_notion::domain::ports::NotionConnections;
use sqlx::PgPool;
use teams::domain::team_repo::TeamRepository;

use crate::domain::service::DatabaseSyncsServiceImpl;
use crate::outbound::databases_tables::DatabasesServiceTables;
use crate::outbound::granola_meetings::ImportedGranolaMeetings;
use crate::outbound::pg_syncs_repo::PgSyncsRepo;
use crate::outbound::team_directory::TeamRoster;

/// The service as every host builds it.
pub type PgDatabaseSyncsService<Databases, EntityAccess, Notion, Teams> = DatabaseSyncsServiceImpl<
    PgSyncsRepo,
    DatabasesServiceTables<Databases>,
    EntityAccessCreators<EntityAccess>,
    ImportedGranolaMeetings,
    Notion,
    TeamRoster<EntityAccess, Teams>,
>;

/// What the syncs service reads its sources through.
pub struct SyncSources<Notion, Teams> {
    /// The call import, for imported Granola meetings.
    pub calls: Arc<dyn CallImportService>,
    /// Whose Granola connection syncs.
    pub granola_accounts: Arc<dyn Accounts>,
    /// Users' Notion workspaces.
    pub notion: Notion,
    /// Team rosters, for people columns.
    pub teams: Arc<Teams>,
}

/// Build the syncs service over `pool`, the host's databases service, its
/// entity access, and the sources.
pub fn build_service<Databases, EntityAccess, Notion, Teams>(
    pool: PgPool,
    databases: Arc<Databases>,
    entity_access: Arc<EntityAccess>,
    sources: SyncSources<Notion, Teams>,
) -> PgDatabaseSyncsService<Databases, EntityAccess, Notion, Teams>
where
    Databases: DatabasesService + DatabaseRowReads,
    EntityAccess: EntityAccessService,
    Notion: NotionConnections,
    Teams: TeamRepository + Send + Sync + 'static,
{
    DatabaseSyncsServiceImpl::new(
        PgSyncsRepo::new(pool),
        DatabasesServiceTables::new(databases),
        EntityAccessCreators::new(entity_access.clone()),
        ImportedGranolaMeetings::new(sources.calls, sources.granola_accounts),
        sources.notion,
        TeamRoster::new(entity_access, sources.teams),
    )
}
