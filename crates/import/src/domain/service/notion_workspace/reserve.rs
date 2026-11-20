//! Reserve every database and saved view before converting referencing bodies.

use super::databases::{DatabaseDestination, DatabaseDestinations};
use super::*;
use crate::domain::models::{TeamClaim, WrittenKind};
use crate::domain::ports::{ImportRepo, ImportedDatabase, NotionDatabaseFallback};
use std::collections::HashSet;

pub(super) struct Reservations {
    pub prepared: HashMap<NotionId, write::PreparedDatabase>,
    pub destinations: DatabaseDestinations,
    pub failures: HashMap<NotionId, String>,
}

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    #[expect(
        clippy::too_many_arguments,
        reason = "the reviewed set, destination layout and durable ledger"
    )]
    #[tracing::instrument(name = "notion.reserve_databases", skip_all, fields(databases = tracing::field::Empty), err)]
    pub(super) async fn reserve_databases(
        &self,
        api: &N::Api,
        user: &MacroUserIdStr<'static>,
        set: &WriteSet,
        place: &Place<'_>,
        team: Option<Uuid>,
        written: &[crate::domain::models::WrittenObject],
        cancel: &write::Cancel,
    ) -> Result<Reservations> {
        let writer = self.creator.as_ref();
        let store = &self.repo;
        let pending: HashSet<Uuid> = set.pending.iter().map(|item| item.import_id).collect();
        let mut prepared = HashMap::new();
        let mut destinations = HashMap::new();
        let mut failures = HashMap::new();
        let source_titles: HashMap<&str, &str> = set
            .all
            .iter()
            .filter(|item| item.kind == ImportKind::DataSource)
            .map(|item| (item.notion_id.as_str(), item.title.as_str()))
            .collect();
        for item in set.all.iter().filter(|item| {
            item.kind == ImportKind::DataSource && item.decision == NotionDecision::Copy
        }) {
            cancel.ensure_running()?;
            let progress = write::Progress::new(store, user, item.import_id, written);
            let outcome: anyhow::Result<()> = async {
            if !pending.contains(&item.import_id) {
                if let Some(row) = store.get(user, item.import_id).await?
                    && row.entity_type.as_deref() == Some(write::DATABASE_ENTITY)
                    && let Some(id) = row.entity_id
                {
                    let database = id.parse()?;
                    let destination = if progress.get(WrittenKind::Database) == Some(database)
                        && let Some(table) = progress.get(WrittenKind::Table)
                    {
                        DatabaseDestination::Ready(writer.database(user, database, models_databases::TableId::from_uuid(table)).await?)
                    } else {
                        reuse_database(writer, store, user, &item.notion_id, database, &progress).await?
                    };
                    if matches!(destination, DatabaseDestination::Fallback(NotionDatabaseFallback::NoAccess)) {
                        progress.warn(&[format!("Source {}: database view access unavailable; occurrences retain Notion links", item.notion_id)]).await?;
                    }
                    destinations.insert(item.notion_id.clone(), destination);
                }
                return Ok(());
            }
            let claim = match team {
                Some(team) if item.shared || item.already_imported => super::super::lifecycle::claim_team_object(store, writer, user, item.import_id, team, item.shared).await?,
                _ => TeamClaim::Free,
            };
            match claim {
                TeamClaim::Linked { entity_id, entity_type } if entity_type == write::DATABASE_ENTITY => {
                    let destination = reuse_database(writer, store, user, &item.notion_id, entity_id.parse()?, &progress).await?;
                    if matches!(destination, DatabaseDestination::Fallback(NotionDatabaseFallback::NoAccess)) {
                        progress.warn(&[format!("Source {}: database view access unavailable; occurrences retain Notion links", item.notion_id)]).await?;
                    }
                    destinations.insert(item.notion_id.clone(), destination);
                    return Ok(());
                }
                TeamClaim::Linked { .. } => return Ok(()),
                TeamClaim::Waiting { .. } => {
                    progress.warn(&[format!("Source {}: another import is still creating its database; occurrences retain Notion links", item.notion_id)]).await?;
                    return Ok(());
                }
                TeamClaim::Held | TeamClaim::Free => {}
            }
            let planned = place.folder_for(item, false);
            // Visibility is the reviewed verdict, independently of who holds a
            // team claim. Reuse the same persistent mirror used for personal pages.
            let visibility = ImportVisibility::from_shared(item.shared);
            let folder = match visibility {
                ImportVisibility::Shared => Some(planned),
                ImportVisibility::Personal => Some(self.personal_item_folder(
                    user, item.import_id, planned, place.path_for(planned)?,
                ).await?),
            };
            let database = write::prepare_database(api, writer, user, item, folder, &progress).await?;
            if item.parent.is_none() && folder == Some(place.root) && !item.dependency_of.is_empty() {
                let row_sources: Vec<&str> = item.dependency_of.iter()
                    .filter_map(|id| source_titles.get(id.as_str()).copied()).collect();
                if row_sources.len() == item.dependency_of.len() {
                    progress.warn(&[format!("Source {}: filed at the Notion folder because it is only referenced from rows of {}", item.notion_id, row_sources.join(", "))]).await?;
                }
            }
            destinations.insert(item.notion_id.clone(), DatabaseDestination::Ready(ImportedDatabase { database_id: database.created.database_id, table: database.created.table, views: database.views.iter().copied().collect() }));
            prepared.insert(item.notion_id.clone(), database);
            Ok(())
        }.await;
            if let Err(error) = outcome {
                let reason = super::super::admission::failure_reason(&error);
                progress.warn(&[format!("Source {}: unresolved database destination: {reason}; occurrences retain Notion links", item.notion_id)]).await?;
                destinations.insert(
                    item.notion_id.clone(),
                    DatabaseDestination::Fallback(NotionDatabaseFallback::Unresolved),
                );
                failures.insert(item.notion_id.clone(), reason);
            }
        }
        tracing::Span::current().record("databases", destinations.len() as i64);
        Ok(Reservations {
            prepared,
            destinations,
            failures,
        })
    }
}

/// Access is checked before reading another owner's import provenance. The
/// host then verifies the recorded table; UI table order is never an identity.
async fn reuse_database<Writer: WorkspaceWriter, Store: WrittenObjects>(
    writer: &Writer,
    store: &Store,
    user: &MacroUserIdStr<'static>,
    source: &NotionId,
    database: Uuid,
    progress: &write::Progress<'_, Store>,
) -> anyhow::Result<DatabaseDestination> {
    if !writer.database_access(user, database).await? {
        return Ok(DatabaseDestination::Fallback(
            NotionDatabaseFallback::NoAccess,
        ));
    }
    let mapping = store
        .database_mapping(user, source, database)
        .await?
        .ok_or_else(|| anyhow::anyhow!("the source holder's recorded table marker is missing"))?;
    let database = writer.database(user, database, mapping.table).await?;
    progress.warn(&mapping.warnings).await?;
    Ok(DatabaseDestination::Ready(database))
}
