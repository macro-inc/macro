//! In-memory stand-ins for the service's ports, recording what was written.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use call::domain::imports::ImportedCallRecord;
use chrono::{TimeZone, Utc};
use databases::domain::models::{DatabaseError, OpRefusal, Viewer};
use databases::domain::ports::CreatorAccess;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};
use import_notion::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionUser, PageMarkdown, Paged, RowsNext, RowsPage,
    SearchHit, SearchObject,
};
use import_notion::domain::ports::{NotionApi, NotionConnections, NotionError};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{
    CellValue, CellWrite, ColumnChange, DatabaseId, DatabaseOp, NewColumn, OpResult, RowChanges,
    RowId, RowsChange, RowsResult, TableChange, TableId, TableResult, TableVersion,
};
use uuid::Uuid;

use crate::domain::columns::TableColumn;
use crate::domain::models::{
    ClaimedSync, DatabaseSync, FinishedRun, NewSyncRecord, SourceKind, SyncId, SyncStatus,
};
use crate::domain::plan::{Fingerprint, RowMapping};
use crate::domain::ports::{
    DatabaseSyncsRepo, GranolaMeetings, SyncDatabase, SyncTable, SyncTables, TeamDirectory,
};

/// A cell value the fake databases service refuses.
pub(crate) const REFUSED: &str = "refused by the databases service";

/// Syncs, the rows they wrote, and every run's end.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeRepo {
    pub(crate) syncs: Arc<Mutex<Vec<DatabaseSync>>>,
    pub(crate) due: Arc<Mutex<Vec<SyncId>>>,
    pub(crate) rows: Arc<Mutex<Vec<(SyncId, RowMapping)>>>,
    pub(crate) finished: Arc<Mutex<Vec<FinishedRun>>>,
}

impl DatabaseSyncsRepo for FakeRepo {
    async fn insert_sync(&self, sync: NewSyncRecord) -> Result<(), rootcause::Report> {
        let mut syncs = self.syncs.lock().unwrap();
        if syncs.iter().any(|stored| stored.id == sync.id) {
            return Ok(());
        }
        syncs.push(DatabaseSync {
            id: sync.id,
            database_id: sync.database_id,
            table_id: sync.table_id,
            created_by: sync.created_by,
            source: sync.source,
            columns: sync.columns,
            detached_columns: vec![],
            status: SyncStatus::Pending,
            last_synced_at: None,
            created_at: Utc.with_ymd_and_hms(2026, 11, 6, 9, 0, 0).unwrap(),
        });
        self.due.lock().unwrap().push(sync.id);
        Ok(())
    }

    async fn sync(&self, sync_id: SyncId) -> Result<Option<DatabaseSync>, rootcause::Report> {
        Ok(self
            .syncs
            .lock()
            .unwrap()
            .iter()
            .find(|sync| sync.id == sync_id)
            .cloned())
    }

    async fn database_syncs(
        &self,
        database_id: DatabaseId,
    ) -> Result<Vec<DatabaseSync>, rootcause::Report> {
        Ok(self
            .syncs
            .lock()
            .unwrap()
            .iter()
            .filter(|sync| sync.database_id == database_id)
            .cloned()
            .collect())
    }

    async fn delete_sync(
        &self,
        database_id: DatabaseId,
        sync_id: SyncId,
    ) -> Result<bool, rootcause::Report> {
        let mut syncs = self.syncs.lock().unwrap();
        let before = syncs.len();
        syncs.retain(|sync| !(sync.database_id == database_id && sync.id == sync_id));
        Ok(syncs.len() != before)
    }

    async fn mark_due(
        &self,
        database_id: DatabaseId,
        sync_id: SyncId,
    ) -> Result<bool, rootcause::Report> {
        let exists = self
            .syncs
            .lock()
            .unwrap()
            .iter()
            .any(|sync| sync.database_id == database_id && sync.id == sync_id);
        if exists {
            self.due.lock().unwrap().push(sync_id);
        }
        Ok(exists)
    }

    async fn mark_source_due(
        &self,
        created_by: &MacroUserIdStr<'static>,
        kind: SourceKind,
    ) -> Result<(), rootcause::Report> {
        let marked: Vec<SyncId> = self
            .syncs
            .lock()
            .unwrap()
            .iter()
            .filter(|sync| &sync.created_by == created_by && sync.source.kind() == kind)
            .map(|sync| sync.id)
            .collect();
        self.due.lock().unwrap().extend(marked);
        Ok(())
    }

    async fn claim_due(
        &self,
        _lease_for: std::time::Duration,
    ) -> Result<Option<ClaimedSync>, rootcause::Report> {
        let mut due = self.due.lock().unwrap();
        if due.is_empty() {
            return Ok(None);
        }
        let sync_id = due.remove(0);
        let sync = self
            .syncs
            .lock()
            .unwrap()
            .iter()
            .find(|sync| sync.id == sync_id)
            .cloned();
        Ok(sync.map(|sync| ClaimedSync {
            sync,
            lease: Uuid::from_u128(77),
        }))
    }

    async fn row_mappings(&self, sync_id: SyncId) -> Result<Vec<RowMapping>, rootcause::Report> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|(owner, _)| *owner == sync_id)
            .map(|(_, mapping)| mapping.clone())
            .collect())
    }

    async fn reserve_rows(
        &self,
        sync_id: SyncId,
        rows: &[(String, RowId)],
    ) -> Result<(), rootcause::Report> {
        let mut stored = self.rows.lock().unwrap();
        for (external_id, row_id) in rows {
            stored.retain(|(owner, mapping)| {
                !(*owner == sync_id && &mapping.external_id == external_id)
            });
            stored.push((
                sync_id,
                RowMapping {
                    external_id: external_id.clone(),
                    row_id: *row_id,
                    fingerprint: None,
                },
            ));
        }
        Ok(())
    }

    async fn record_rows(
        &self,
        sync_id: SyncId,
        rows: &[(String, RowId, Fingerprint)],
    ) -> Result<(), rootcause::Report> {
        let mut stored = self.rows.lock().unwrap();
        for (external_id, row_id, fingerprint) in rows {
            stored.retain(|(owner, mapping)| {
                !(*owner == sync_id && &mapping.external_id == external_id)
            });
            stored.push((
                sync_id,
                RowMapping {
                    external_id: external_id.clone(),
                    row_id: *row_id,
                    fingerprint: Some(*fingerprint),
                },
            ));
        }
        Ok(())
    }

    async fn forget_rows(
        &self,
        sync_id: SyncId,
        external_ids: &[String],
    ) -> Result<(), rootcause::Report> {
        self.rows.lock().unwrap().retain(|(owner, mapping)| {
            !(*owner == sync_id && external_ids.contains(&mapping.external_id))
        });
        Ok(())
    }

    async fn finish(
        &self,
        sync_id: SyncId,
        _lease: Uuid,
        run: FinishedRun,
    ) -> Result<bool, rootcause::Report> {
        let mut syncs = self.syncs.lock().unwrap();
        if let Some(sync) = syncs.iter_mut().find(|sync| sync.id == sync_id) {
            sync.columns = run.columns.clone();
            sync.detached_columns = run.detached_columns.clone();
            sync.status = match run.failure {
                Some(failure) => SyncStatus::Failed { failure },
                None => SyncStatus::Synced,
            };
        }
        self.finished.lock().unwrap().push(run);
        Ok(true)
    }
}

/// Rows by id, each with its table and cells.
type StoredRows = HashMap<RowId, (TableId, Vec<CellWrite>)>;

/// A databases service in memory: tables with typed columns, rows by id,
/// and every batch it applied.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeTables {
    pub(crate) databases: Arc<Mutex<HashMap<DatabaseId, Vec<SyncTable>>>>,
    pub(crate) rows: Arc<Mutex<StoredRows>>,
    pub(crate) batches: Arc<Mutex<Vec<Vec<DatabaseOp>>>>,
    pub(crate) created_databases: Arc<Mutex<Vec<(String, String)>>>,
}

impl FakeTables {
    /// The rows of a table, by id.
    pub(crate) fn table_rows(&self, table: TableId) -> HashMap<RowId, Vec<CellWrite>> {
        self.rows
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, (owner, _))| *owner == table)
            .map(|(id, (_, cells))| (*id, cells.clone()))
            .collect()
    }

    fn apply_op(
        &self,
        database_id: DatabaseId,
        index: usize,
        op: &DatabaseOp,
    ) -> Result<OpResult, DatabaseError> {
        let mut databases = self.databases.lock().unwrap();
        let tables = databases
            .get_mut(&database_id)
            .ok_or(DatabaseError::NotFound)?;
        let version = TableVersion(1);
        let refuse = |row: Option<usize>, reason: &str| {
            DatabaseError::InvalidOp(OpRefusal {
                op: index,
                row,
                column: None,
                taken: None,
                reason: reason.to_string(),
            })
        };
        match op {
            DatabaseOp::Table { table, change } => match change {
                TableChange::Create { name } => {
                    tables.push(SyncTable {
                        id: *table,
                        name: name.clone(),
                        columns: vec![],
                    });
                    Ok(OpResult::Table {
                        table: *table,
                        table_version: Some(version),
                        change: TableResult::Created,
                    })
                }
                TableChange::Delete => {
                    tables.retain(|existing| existing.id != *table);
                    Ok(OpResult::Table {
                        table: *table,
                        table_version: None,
                        change: TableResult::Deleted,
                    })
                }
                other => Err(refuse(None, &format!("not faked: {other:?}"))),
            },
            DatabaseOp::Column {
                table,
                column,
                change,
            } => {
                let table_entry = tables
                    .iter_mut()
                    .find(|existing| existing.id == *table)
                    .ok_or(DatabaseError::NotFound)?;
                match change {
                    ColumnChange::Create {
                        definition:
                            NewColumn::New {
                                name,
                                kind,
                                options,
                                ..
                            },
                        ..
                    } => {
                        table_entry.columns.push(TableColumn {
                            id: *column,
                            name: name.clone(),
                            kind: Some(*kind),
                            options: options
                                .iter()
                                .map(|option| (option.id, option.label.clone()))
                                .collect(),
                        });
                    }
                    ColumnChange::AddOptions { options } => {
                        let column_entry = table_entry
                            .columns
                            .iter_mut()
                            .find(|existing| existing.id == *column)
                            .ok_or(DatabaseError::NotFound)?;
                        column_entry.options.extend(
                            options
                                .iter()
                                .map(|option| (option.id, option.label.clone())),
                        );
                    }
                    other => return Err(refuse(None, &format!("not faked: {other:?}"))),
                }
                Ok(OpResult::Column {
                    table: *table,
                    column: *column,
                    table_version: version,
                    change: models_databases::ColumnResult::Created,
                })
            }
            DatabaseOp::Rows { table, change } => {
                let mut rows = self.rows.lock().unwrap();
                let refused = |cells: &[CellWrite]| {
                    cells
                        .iter()
                        .any(|cell| cell.value == CellValue::Text(REFUSED.to_string()))
                };
                let result = match change {
                    RowsChange::Insert { rows: new, ids } => {
                        let ids = ids.clone().unwrap_or_default();
                        for (row, cells) in new.iter().enumerate() {
                            if refused(cells) {
                                return Err(refuse(Some(row), "the cell does not fit"));
                            }
                        }
                        for (id, cells) in ids.iter().zip(new) {
                            rows.insert(*id, (*table, cells.clone()));
                        }
                        RowsResult::Inserted { rows: ids }
                    }
                    RowsChange::Update {
                        changes: RowChanges::PerRow { rows: changed },
                    } => {
                        for (row, change) in changed.iter().enumerate() {
                            if refused(&change.cells) {
                                return Err(refuse(Some(row), "the cell does not fit"));
                            }
                            if !rows.contains_key(&change.row) {
                                return Err(DatabaseError::NotFound);
                            }
                        }
                        for change in changed {
                            let stored = &mut rows.get_mut(&change.row).unwrap().1;
                            for cell in &change.cells {
                                stored.retain(|existing| existing.column != cell.column);
                                if cell.value != CellValue::Clear {
                                    stored.push(cell.clone());
                                }
                            }
                        }
                        RowsResult::Updated {
                            affected: changed.len() as u32,
                        }
                    }
                    RowsChange::Delete { rows: removed } => {
                        for row in removed {
                            rows.remove(row);
                        }
                        RowsResult::Deleted {
                            affected: removed.len() as u32,
                        }
                    }
                    other => return Err(refuse(None, &format!("not faked: {other:?}"))),
                };
                Ok(OpResult::Rows {
                    table: *table,
                    table_version: version,
                    change: result,
                })
            }
            other => Err(refuse(None, &format!("not faked: {other:?}"))),
        }
    }
}

impl SyncTables for FakeTables {
    async fn database(
        &self,
        database_id: DatabaseId,
    ) -> Result<Option<SyncDatabase>, DatabaseError> {
        Ok(self
            .databases
            .lock()
            .unwrap()
            .get(&database_id)
            .map(|tables| SyncDatabase {
                tables: tables.clone(),
            }))
    }

    async fn existing_rows(
        &self,
        _database_id: DatabaseId,
        table_id: TableId,
        rows: &[RowId],
    ) -> Result<HashSet<RowId>, DatabaseError> {
        let stored = self.rows.lock().unwrap();
        Ok(rows
            .iter()
            .filter(|row| matches!(stored.get(row), Some((table, _)) if *table == table_id))
            .copied()
            .collect())
    }

    async fn apply(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: Viewer,
        ops: Vec<DatabaseOp>,
    ) -> Result<Vec<OpResult>, DatabaseError> {
        let database_id: DatabaseId = receipt.entity().entity_id.parse().unwrap();
        // All or nothing: apply to copies, keep them only when every op fits.
        let saved_databases = self.databases.lock().unwrap().clone();
        let saved_rows = self.rows.lock().unwrap().clone();
        let mut results = Vec::new();
        for (index, op) in ops.iter().enumerate() {
            match self.apply_op(database_id, index, op) {
                Ok(result) => results.push(result),
                Err(error) => {
                    *self.databases.lock().unwrap() = saved_databases;
                    *self.rows.lock().unwrap() = saved_rows;
                    return Err(error);
                }
            }
        }
        self.batches.lock().unwrap().push(ops);
        Ok(results)
    }

    async fn create_database(
        &self,
        owner: &MacroUserIdStr<'static>,
        name: String,
    ) -> Result<(DatabaseId, TableId), DatabaseError> {
        let database_id = DatabaseId::from_uuid(Uuid::from_u128(500));
        let starter = TableId::from_uuid(Uuid::from_u128(501));
        self.databases.lock().unwrap().insert(
            database_id,
            vec![SyncTable {
                id: starter,
                name: "Table 1".to_string(),
                columns: vec![],
            }],
        );
        self.created_databases
            .lock()
            .unwrap()
            .push((owner.to_string(), name));
        Ok((database_id, starter))
    }

    async fn delete_database(&self, database_id: DatabaseId) -> Result<(), DatabaseError> {
        self.databases.lock().unwrap().remove(&database_id);
        Ok(())
    }
}

/// Who can edit which database.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeAccess {
    pub(crate) editors: Arc<Mutex<Vec<(String, DatabaseId)>>>,
}

impl CreatorAccess for FakeAccess {
    async fn edit_receipt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
    ) -> Result<Option<EntityAccessReceipt<EditAccessLevel>>, rootcause::Report> {
        let can_edit = self
            .editors
            .lock()
            .unwrap()
            .contains(&(user_id.to_string(), database_id));
        Ok(can_edit.then(|| {
            EntityAccessReceipt::dangerously_assert_authenticated_user(
                user_id.clone(),
                &database_id.to_string(),
                EntityType::Database,
            )
        }))
    }
}

/// One user's Granola meetings.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeGranola {
    pub(crate) connected: bool,
    pub(crate) meetings: Arc<Mutex<Vec<ImportedCallRecord>>>,
}

impl GranolaMeetings for FakeGranola {
    async fn connected(&self, _user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        Ok(self.connected)
    }

    async fn meetings(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallRecord>, rootcause::Report> {
        Ok(self.meetings.lock().unwrap().clone())
    }
}

/// One Notion workspace: a data source, its rows, and its people.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeNotion {
    pub(crate) connected: bool,
    pub(crate) source: Arc<Mutex<Option<NotionDataSource>>>,
    pub(crate) rows: Arc<Mutex<Vec<NotionPage>>>,
    /// Whether the row query is cut off at Notion's cap.
    pub(crate) truncated: Arc<Mutex<bool>>,
    pub(crate) users: Arc<Mutex<Vec<NotionUser>>>,
}

impl NotionApi for FakeNotion {
    async fn search(
        &self,
        object: SearchObject,
        _cursor: Option<String>,
    ) -> Result<Paged<SearchHit>, NotionError> {
        assert_eq!(object, SearchObject::DataSource);
        Ok(Paged {
            results: self
                .source
                .lock()
                .unwrap()
                .iter()
                .cloned()
                .map(SearchHit::DataSource)
                .collect(),
            next_cursor: None,
        })
    }

    async fn page(&self, _id: &NotionId) -> Result<NotionPage, NotionError> {
        unimplemented!("syncs read rows through the data source query")
    }

    async fn page_markdown(&self, _id: &NotionId) -> Result<PageMarkdown, NotionError> {
        unimplemented!("syncs read no page bodies")
    }

    async fn data_source(&self, id: &NotionId) -> Result<NotionDataSource, NotionError> {
        self.source
            .lock()
            .unwrap()
            .clone()
            .filter(|source| &source.id == id)
            .ok_or(NotionError::NotFound)
    }

    async fn database_sources(&self, _database: &NotionId) -> Result<Vec<NotionId>, NotionError> {
        unimplemented!("syncs name data sources directly")
    }

    async fn query_data_source(
        &self,
        _id: &NotionId,
        _cursor: Option<String>,
    ) -> Result<RowsPage, NotionError> {
        Ok(RowsPage {
            rows: self.rows.lock().unwrap().clone(),
            next: if *self.truncated.lock().unwrap() {
                RowsNext::Truncated
            } else {
                RowsNext::End
            },
        })
    }

    async fn users(&self, _cursor: Option<String>) -> Result<Paged<NotionUser>, NotionError> {
        Ok(Paged {
            results: self.users.lock().unwrap().clone(),
            next_cursor: None,
        })
    }
}

impl NotionConnections for FakeNotion {
    type Api = FakeNotion;

    async fn for_user(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Option<Self::Api>, NotionError> {
        Ok(self.connected.then(|| self.clone()))
    }
}

/// A user's team.
#[derive(Debug, Clone, Default)]
pub(crate) struct FakeTeam {
    pub(crate) members: Vec<MacroUserIdStr<'static>>,
}

impl TeamDirectory for FakeTeam {
    async fn team_members(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Ok(self.members.clone())
    }
}
