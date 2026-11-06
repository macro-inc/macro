//! The syncs service: every decision beyond the receipt its caller minted,
//! over its ports. Runs live in `run`.

mod run;
#[cfg(test)]
mod test;

use std::time::Duration;

use databases::domain::models::{DatabaseError, Viewer};
use databases::domain::ports::CreatorAccess;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, RequiredPermission,
};
use import_notion::domain::inventory::{all_rows, all_users};
use import_notion::domain::macro_cells::{PeopleMap, Person, capped_name};
use import_notion::domain::model::{NotionId, SearchHit, SearchObject};
use import_notion::domain::ports::{NotionApi, NotionConnections, NotionError};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{DatabaseId, DatabaseOp, TableChange};

use crate::domain::columns::{WantedColumn, reconcile, unique_name};
use crate::domain::models::{
    AvailableSources, DatabaseSync, DatabaseSyncError, GranolaAvailability, NewSync, NewSyncRecord,
    NotionAvailability, NotionDataSourceSummary, SourceKind, SyncId, SyncSource,
};
use crate::domain::ports::{
    DatabaseSyncsRepo, DatabaseSyncsService, GranolaMeetings, SyncTables, TeamDirectory,
};
use crate::domain::source::{
    GRANOLA_TABLE_NAME, NotionColumns, SourceItem, granola_columns, granola_item, table_id,
};

/// How long a worker holds a sync; a run is cut off well before.
pub const LEASE: Duration = Duration::from_secs(15 * 60);

/// How often a Granola table syncs; new meetings also mark it due.
const GRANOLA_EVERY: Duration = Duration::from_secs(15 * 60);

/// How often a Notion table syncs.
const NOTION_EVERY: Duration = Duration::from_secs(30 * 60);

/// Name for a source with a blank title.
const UNTITLED: &str = "Untitled";

/// The syncs service over its ports.
#[derive(Debug, Clone)]
pub struct DatabaseSyncsServiceImpl<Repository, Tables, Access, Granola, Notion, Team> {
    repository: Repository,
    tables: Tables,
    access: Access,
    granola: Granola,
    notion: Notion,
    team: Team,
}

impl<Repository, Tables, Access, Granola, Notion, Team>
    DatabaseSyncsServiceImpl<Repository, Tables, Access, Granola, Notion, Team>
{
    /// A service from its ports.
    pub fn new(
        repository: Repository,
        tables: Tables,
        access: Access,
        granola: Granola,
        notion: Notion,
        team: Team,
    ) -> Self {
        Self {
            repository,
            tables,
            access,
            granola,
            notion,
            team,
        }
    }
}

/// Why a source could not be read.
#[derive(Debug)]
enum SourceError {
    /// The user has not connected it.
    Disconnected,
    /// It is gone, or the connection may not read it.
    NotFound,
    /// It could not be read just now.
    Unavailable(rootcause::Report),
    /// Macro failed to read what the source needs.
    Internal(rootcause::Report),
}

impl From<SourceError> for DatabaseSyncError {
    fn from(error: SourceError) -> Self {
        match error {
            SourceError::Disconnected => DatabaseSyncError::SourceDisconnected,
            SourceError::NotFound => DatabaseSyncError::SourceNotFound,
            SourceError::Unavailable(report) => DatabaseSyncError::SourceUnavailable(report),
            SourceError::Internal(report) => DatabaseSyncError::Repository(report),
        }
    }
}

fn notion_error(error: NotionError) -> SourceError {
    match error {
        NotionError::NotFound | NotionError::Forbidden => SourceError::NotFound,
        NotionError::RateLimited { .. }
        | NotionError::Upstream { .. }
        | NotionError::Decode(_)
        | NotionError::Transport(_) => {
            SourceError::Unavailable(rootcause::report!("reading Notion: {error}"))
        }
    }
}

/// A source read in full: the columns it wants and its rows.
struct SourceRead {
    wanted: Vec<WantedColumn>,
    items: Vec<SourceItem>,
    /// Whether every row was read; only then may rows be deleted.
    complete: bool,
}

/// The database a receipt was minted for.
fn receipt_database_id<Level: RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Result<DatabaseId, DatabaseSyncError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::Database {
        return Err(DatabaseSyncError::NotFound);
    }
    entity
        .entity_id
        .parse()
        .map_err(|_| DatabaseSyncError::NotFound)
}

fn database_error(error: DatabaseError) -> DatabaseSyncError {
    match error {
        DatabaseError::NotFound => DatabaseSyncError::NotFound,
        other => DatabaseSyncError::Database(other),
    }
}

/// When a sync of this kind runs next.
fn cadence(kind: SourceKind) -> Duration {
    match kind {
        SourceKind::GranolaMeetings => GRANOLA_EVERY,
        SourceKind::NotionDataSource => NOTION_EVERY,
    }
}

impl<Repository, Tables, Access, Granola, Notion, Team>
    DatabaseSyncsServiceImpl<Repository, Tables, Access, Granola, Notion, Team>
where
    Repository: DatabaseSyncsRepo,
    Tables: SyncTables,
    Access: CreatorAccess,
    Granola: GranolaMeetings,
    Notion: NotionConnections,
    Team: TeamDirectory,
{
    /// The sync a retried create already made: one with the same id, source
    /// and creator (and database, when one is named). Another sync under the
    /// id refuses the create.
    async fn retried(
        &self,
        sync: &NewSync,
        creator: &MacroUserIdStr<'static>,
        database_id: Option<DatabaseId>,
    ) -> Result<Option<DatabaseSync>, DatabaseSyncError> {
        let Some(existing) = self
            .repository
            .sync(sync.id)
            .await
            .map_err(DatabaseSyncError::Repository)?
        else {
            return Ok(None);
        };

        let same_database = database_id.is_none_or(|id| id == existing.database_id);
        if existing.source == sync.source && &existing.created_by == creator && same_database {
            Ok(Some(existing))
        } else {
            Err(DatabaseSyncError::IdTaken)
        }
    }

    /// The user's Notion workspace.
    async fn notion_api(&self, user: &MacroUserIdStr<'static>) -> Result<Notion::Api, SourceError> {
        self.notion
            .for_user(user)
            .await
            .map_err(notion_error)?
            .ok_or(SourceError::Disconnected)
    }

    /// What a new table for the source is called, and its columns.
    async fn source_columns(
        &self,
        user: &MacroUserIdStr<'static>,
        sync_id: SyncId,
        source: &SyncSource,
    ) -> Result<(String, Vec<WantedColumn>), SourceError> {
        match source {
            SyncSource::GranolaMeetings => {
                let connected = self
                    .granola
                    .connected(user)
                    .await
                    .map_err(SourceError::Internal)?;
                if !connected {
                    return Err(SourceError::Disconnected);
                }
                Ok((GRANOLA_TABLE_NAME.to_string(), granola_columns(sync_id)))
            }
            SyncSource::NotionDataSource { data_source_id } => {
                let api = self.notion_api(user).await?;
                let data_source = api
                    .data_source(data_source_id)
                    .await
                    .map_err(notion_error)?;
                if data_source.in_trash {
                    return Err(SourceError::NotFound);
                }
                let mut name = capped_name(&data_source.title);
                if name.is_empty() {
                    name = UNTITLED.to_string();
                }
                let columns = NotionColumns::new(sync_id, &data_source);
                Ok((name, columns.wanted().to_vec()))
            }
        }
    }

    /// Everything the source holds now.
    async fn read_source(
        &self,
        user: &MacroUserIdStr<'static>,
        sync_id: SyncId,
        source: &SyncSource,
    ) -> Result<SourceRead, SourceError> {
        match source {
            SyncSource::GranolaMeetings => {
                // Meetings already imported stay synced even when Granola is
                // disconnected; new ones stop arriving.
                let meetings = self
                    .granola
                    .meetings(user)
                    .await
                    .map_err(SourceError::Internal)?;
                Ok(SourceRead {
                    wanted: granola_columns(sync_id),
                    items: meetings.iter().map(granola_item).collect(),
                    complete: true,
                })
            }
            SyncSource::NotionDataSource { data_source_id } => {
                self.read_notion(user, sync_id, data_source_id).await
            }
        }
    }

    async fn read_notion(
        &self,
        user: &MacroUserIdStr<'static>,
        sync_id: SyncId,
        data_source_id: &NotionId,
    ) -> Result<SourceRead, SourceError> {
        let api = self.notion_api(user).await?;
        let data_source = api
            .data_source(data_source_id)
            .await
            .map_err(notion_error)?;
        if data_source.in_trash {
            return Err(SourceError::NotFound);
        }
        let columns = NotionColumns::new(sync_id, &data_source);
        let rows = all_rows(&api, data_source_id).await.map_err(notion_error)?;
        let people = self.people(&api, user).await?;
        Ok(SourceRead {
            wanted: columns.wanted().to_vec(),
            items: rows
                .rows
                .iter()
                .filter(|row| !row.in_trash)
                .map(|row| columns.item(row, &people))
                .collect(),
            complete: rows.complete,
        })
    }

    /// Notion users matched to the user's team by email. A connection Notion
    /// will not list users for leaves people columns empty, on every run
    /// alike.
    async fn people(
        &self,
        api: &Notion::Api,
        user: &MacroUserIdStr<'static>,
    ) -> Result<PeopleMap, SourceError> {
        let notion_users = match all_users(api).await {
            Ok(users) => users,
            Err(NotionError::Forbidden) => return Ok(PeopleMap::new()),
            Err(error) => return Err(notion_error(error)),
        };
        let members = self
            .team
            .team_members(user)
            .await
            .map_err(SourceError::Internal)?;
        Ok(notion_users
            .into_iter()
            .map(|notion_user| {
                let email = notion_user.email.map(|email| email.to_lowercase());
                let macro_user = email.as_ref().and_then(|email| {
                    members
                        .iter()
                        .find(|member| member.email_str() == email.as_str())
                        .cloned()
                });
                (notion_user.id, Person { email, macro_user })
            })
            .collect())
    }

    /// Add the synced table to the database, then store the sync. A table an
    /// earlier attempt of this create made is taken up, not made twice; a
    /// table whose sync cannot be stored is removed again.
    #[expect(
        clippy::too_many_arguments,
        reason = "a synced table needs its database, creator, source, name, columns and the ops riding along"
    )]
    async fn create_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        creator: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
        sync: NewSync,
        name: String,
        wanted: Vec<WantedColumn>,
        extra_ops: Vec<DatabaseOp>,
    ) -> Result<DatabaseSync, DatabaseSyncError> {
        let viewer = Viewer {
            user_id: creator.clone(),
            acting_bot: None,
        };
        let database = self
            .tables
            .database(database_id)
            .await
            .map_err(database_error)?
            .ok_or(DatabaseSyncError::NotFound)?;
        let table = table_id(sync.id);

        let columns = match database.tables.iter().find(|existing| existing.id == table) {
            Some(existing) => reconcile(table, &[], &[], &existing.columns, &wanted).columns,
            None => {
                let taken = database
                    .tables
                    .iter()
                    .map(|existing| existing.name.to_lowercase())
                    .collect();
                let changes = reconcile(table, &[], &[], &[], &wanted);
                let ops = std::iter::once(DatabaseOp::Table {
                    table,
                    change: TableChange::Create {
                        name: unique_name(&name, &taken),
                    },
                })
                .chain(changes.ops)
                .chain(extra_ops)
                .collect();
                self.tables
                    .apply(receipt.clone(), viewer.clone(), ops)
                    .await
                    .map_err(database_error)?;
                changes.columns
            }
        };

        let stored = self
            .repository
            .insert_sync(NewSyncRecord {
                id: sync.id,
                database_id,
                table_id: table,
                created_by: creator.clone(),
                source: sync.source,
                columns,
            })
            .await;
        if let Err(error) = stored {
            let _ = self
                .tables
                .apply(
                    receipt,
                    viewer,
                    vec![DatabaseOp::Table {
                        table,
                        change: TableChange::Delete,
                    }],
                )
                .await
                .inspect_err(|undo| {
                    tracing::warn!(error = ?undo, sync_id = %sync.id, "the synced table of a failed create stayed");
                });
            return Err(DatabaseSyncError::Repository(error));
        }

        self.repository
            .sync(sync.id)
            .await
            .map_err(DatabaseSyncError::Repository)?
            .ok_or_else(|| {
                DatabaseSyncError::Repository(rootcause::report!("a stored sync was not found"))
            })
    }
}

impl<Repository, Tables, Access, Granola, Notion, Team> DatabaseSyncsService
    for DatabaseSyncsServiceImpl<Repository, Tables, Access, Granola, Notion, Team>
where
    Repository: DatabaseSyncsRepo,
    Tables: SyncTables,
    Access: CreatorAccess,
    Granola: GranolaMeetings,
    Notion: NotionConnections,
    Team: TeamDirectory,
{
    #[tracing::instrument(skip(self, receipt), fields(sync_id = %sync.id, source = sync.source.kind().as_ref()), err)]
    async fn create_sync(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sync: NewSync,
    ) -> Result<DatabaseSync, DatabaseSyncError> {
        let database_id = receipt_database_id(&receipt)?;
        let Some(creator) = receipt.acting_user_id().cloned() else {
            return Err(DatabaseSyncError::Forbidden(
                "only a signed-in person can sync a table",
            ));
        };
        if let Some(existing) = self.retried(&sync, &creator, Some(database_id)).await? {
            return Ok(existing);
        }

        let (name, wanted) = self.source_columns(&creator, sync.id, &sync.source).await?;
        self.create_table(
            receipt,
            &creator,
            database_id,
            sync,
            name,
            wanted,
            Vec::new(),
        )
        .await
    }

    #[tracing::instrument(skip(self, user), fields(sync_id = %sync.id, source = sync.source.kind().as_ref()), err)]
    async fn create_synced_database(
        &self,
        user: &MacroUserIdStr<'static>,
        sync: NewSync,
    ) -> Result<DatabaseSync, DatabaseSyncError> {
        if let Some(existing) = self.retried(&sync, user, None).await? {
            return Ok(existing);
        }

        let (name, wanted) = self.source_columns(user, sync.id, &sync.source).await?;
        let (database_id, starter_table) = self
            .tables
            .create_database(user, name.clone())
            .await
            .map_err(database_error)?;

        let created = async {
            let receipt = self
                .access
                .edit_receipt(user, database_id)
                .await
                .map_err(DatabaseSyncError::Repository)?
                .ok_or(DatabaseSyncError::Forbidden(
                    "the new database is not editable by its owner",
                ))?;
            // The synced table takes the starter table's place.
            let remove_starter = DatabaseOp::Table {
                table: starter_table,
                change: TableChange::Delete,
            };
            self.create_table(
                receipt,
                user,
                database_id,
                sync,
                name,
                wanted,
                vec![remove_starter],
            )
            .await
        }
        .await;

        if created.is_err() {
            let _ = self
                .tables
                .delete_database(database_id)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, database_id = %database_id, "the database of a failed synced create stayed");
                });
        }
        created
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn list_syncs(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<Vec<DatabaseSync>, DatabaseSyncError> {
        let database_id = receipt_database_id(&receipt)?;
        self.repository
            .database_syncs(database_id)
            .await
            .map_err(DatabaseSyncError::Repository)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn sync_now(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sync_id: SyncId,
    ) -> Result<(), DatabaseSyncError> {
        let database_id = receipt_database_id(&receipt)?;
        let marked = self
            .repository
            .mark_due(database_id, sync_id)
            .await
            .map_err(DatabaseSyncError::Repository)?;
        if marked {
            Ok(())
        } else {
            Err(DatabaseSyncError::NotFound)
        }
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn delete_sync(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sync_id: SyncId,
    ) -> Result<(), DatabaseSyncError> {
        let database_id = receipt_database_id(&receipt)?;
        let deleted = self
            .repository
            .delete_sync(database_id, sync_id)
            .await
            .map_err(DatabaseSyncError::Repository)?;
        if deleted {
            Ok(())
        } else {
            Err(DatabaseSyncError::NotFound)
        }
    }

    #[tracing::instrument(skip_all, fields(data_sources), err)]
    async fn sources(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<AvailableSources, DatabaseSyncError> {
        let granola = GranolaAvailability {
            connected: self
                .granola
                .connected(user)
                .await
                .map_err(DatabaseSyncError::Repository)?,
        };
        let notion = match self.notion.for_user(user).await.map_err(notion_error)? {
            None => NotionAvailability {
                connected: false,
                data_sources: Vec::new(),
            },
            Some(api) => NotionAvailability {
                connected: true,
                data_sources: notion_data_sources(&api).await?,
            },
        };
        tracing::Span::current().record("data_sources", notion.data_sources.len());
        Ok(AvailableSources { granola, notion })
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn source_changed(
        &self,
        user: &MacroUserIdStr<'static>,
        kind: SourceKind,
    ) -> Result<(), DatabaseSyncError> {
        self.repository
            .mark_source_due(user, kind)
            .await
            .map_err(DatabaseSyncError::Repository)
    }

    async fn run_due(&self) -> Result<bool, DatabaseSyncError> {
        let Some(claimed) = self
            .repository
            .claim_due(LEASE)
            .await
            .map_err(DatabaseSyncError::Repository)?
        else {
            return Ok(false);
        };
        self.run_claimed(claimed).await?;
        Ok(true)
    }
}

/// Every data source the connection can read, most recently edited first.
async fn notion_data_sources<Api: NotionApi>(
    api: &Api,
) -> Result<Vec<NotionDataSourceSummary>, SourceError> {
    let mut summaries = Vec::new();
    let mut cursor = None;
    loop {
        let page = api
            .search(SearchObject::DataSource, cursor)
            .await
            .map_err(notion_error)?;
        for hit in page.results {
            let SearchHit::DataSource(source) = hit else {
                continue;
            };
            if source.in_trash {
                continue;
            }
            let mut title = capped_name(&source.title);
            if title.is_empty() {
                title = UNTITLED.to_string();
            }
            summaries.push(NotionDataSourceSummary {
                id: source.id,
                title,
            });
        }
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => return Ok(summaries),
        }
    }
}
