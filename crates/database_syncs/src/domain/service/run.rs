//! One run of a sync: read the source, bring the table's columns in step,
//! then insert, update and delete rows in batches, recording each batch so
//! a run cut short resumes without duplicating rows.

use std::collections::HashMap;

use databases::domain::models::{DatabaseError, OpRefusal, Viewer};
use databases::domain::ports::CreatorAccess;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use import_notion::domain::ports::NotionConnections;
use models_databases::{
    CellValue, CellWrite, DatabaseOp, OptionId, OptionRef, RowChange, RowChanges, RowId,
    RowsChange, TableId,
};
use tracing::Instrument;

use super::{DatabaseSyncsServiceImpl, SourceError, cadence};
use crate::domain::columns::reconcile;
use crate::domain::models::{
    ClaimedSync, DatabaseSync, DatabaseSyncError, DetachedColumn, FinishedRun, SyncFailure,
    SyncField, SyncedColumn,
};
use crate::domain::plan::{RowDelete, RowInsert, RowUpdate, SourceRow, plan};
use crate::domain::ports::{DatabaseSyncsRepo, GranolaMeetings, SyncTables, TeamDirectory};
use crate::domain::source::SourceItem;

/// Rows per write. A run writes, then records, one batch at a time.
const BATCH: usize = 500;

/// Why a run stopped, and what went wrong.
struct RunFailure {
    failure: SyncFailure,
    cause: rootcause::Report,
}

fn failed(failure: SyncFailure, cause: rootcause::Report) -> RunFailure {
    RunFailure { failure, cause }
}

fn repository_failure(cause: rootcause::Report) -> RunFailure {
    failed(SyncFailure::Internal, cause)
}

fn database_failure(error: DatabaseError) -> RunFailure {
    let failure = match error {
        DatabaseError::NotFound => SyncFailure::DatabaseUnavailable,
        DatabaseError::Unauthorized => SyncFailure::CreatorLostAccess,
        _ => SyncFailure::Internal,
    };
    failed(
        failure,
        rootcause::report!("writing the synced table: {error}"),
    )
}

impl From<SourceError> for RunFailure {
    fn from(error: SourceError) -> Self {
        match error {
            SourceError::Disconnected => failed(
                SyncFailure::SourceDisconnected,
                rootcause::report!("the creator's connection is gone"),
            ),
            SourceError::NotFound => failed(
                SyncFailure::SourceNotFound,
                rootcause::report!("the source is gone or unreadable"),
            ),
            SourceError::Unavailable(cause) => failed(SyncFailure::SourceUnavailable, cause),
            SourceError::Internal(cause) => failed(SyncFailure::Internal, cause),
        }
    }
}

/// What a run wrote.
#[derive(Debug, Default)]
struct RunCounts {
    inserted: usize,
    updated: usize,
    deleted: usize,
    /// Rows the databases service refused, left for the next run.
    skipped: usize,
    complete: bool,
}

/// The columns a run leaves the sync with, kept as the run changes them so
/// a failed run still records what it did.
struct RunColumns {
    columns: Vec<SyncedColumn>,
    detached: Vec<DetachedColumn>,
}

/// Where a run writes, and as whom.
struct Target {
    receipt: EntityAccessReceipt<EditAccessLevel>,
    viewer: Viewer,
    table: TableId,
}

/// A row's cells for every synced column the source still has, cleared
/// where the row has no value, with option ids the column knows.
fn render(
    item: SourceItem,
    columns: &[&SyncedColumn],
    option_ids: &HashMap<OptionId, OptionId>,
) -> SourceRow {
    let mut values: HashMap<SyncField, CellValue> = item.values.into_iter().collect();
    let cells = columns
        .iter()
        .map(|column| CellWrite {
            column: column.column,
            value: match values.remove(&column.field) {
                Some(CellValue::Options(options)) => CellValue::Options(
                    options
                        .into_iter()
                        .map(|option| match option {
                            OptionRef::Id(id) => {
                                OptionRef::Id(option_ids.get(&id).copied().unwrap_or(id))
                            }
                            OptionRef::Label(label) => OptionRef::Label(label),
                        })
                        .collect(),
                ),
                Some(value) => value,
                None => CellValue::Clear,
            },
        })
        .collect();
    SourceRow {
        external_id: item.external_id,
        cells,
    }
}

/// The row a refusal names, when one row of the op is at fault.
fn refused_row(error: &DatabaseError, rows: usize) -> Option<usize> {
    match error {
        DatabaseError::InvalidOp(OpRefusal {
            row: Some(row),
            taken: None,
            ..
        }) if *row < rows => Some(*row),
        _ => None,
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
    /// Run a claimed sync and record how it went.
    pub(super) async fn run_claimed(&self, claimed: ClaimedSync) -> Result<(), DatabaseSyncError> {
        let sync = claimed.sync;
        let span = tracing::info_span!(
            "database_sync.run",
            sync_id = %sync.id,
            database_id = %sync.database_id,
            table_id = %sync.table_id,
            source = sync.source.kind().as_ref(),
            inserted = tracing::field::Empty,
            updated = tracing::field::Empty,
            deleted = tracing::field::Empty,
            skipped = tracing::field::Empty,
            complete = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let mut columns = RunColumns {
            columns: sync.columns.clone(),
            detached: sync.detached_columns.clone(),
        };

        let result = self.run(&sync, &mut columns).instrument(span.clone()).await;
        let failure = match result {
            Ok(counts) => {
                span.record("inserted", counts.inserted);
                span.record("updated", counts.updated);
                span.record("deleted", counts.deleted);
                span.record("skipped", counts.skipped);
                span.record("complete", counts.complete);
                span.record("outcome", "synced");
                None
            }
            Err(run_failure) => {
                span.record("outcome", run_failure.failure.as_ref());
                span.in_scope(|| {
                    tracing::warn!(
                        error = ?run_failure.cause,
                        failure = run_failure.failure.as_ref(),
                        "database sync run failed"
                    );
                });
                Some(run_failure.failure)
            }
        };

        let finished = self
            .repository
            .finish(
                sync.id,
                claimed.lease,
                FinishedRun {
                    columns: columns.columns,
                    detached_columns: columns.detached,
                    failure,
                    next_run_in: cadence(sync.source.kind()),
                },
            )
            .instrument(span.clone())
            .await
            .map_err(DatabaseSyncError::Repository)?;
        if !finished {
            span.in_scope(|| tracing::warn!("a database sync run outlived its lease"));
        }
        Ok(())
    }

    async fn run(
        &self,
        sync: &DatabaseSync,
        columns: &mut RunColumns,
    ) -> Result<RunCounts, RunFailure> {
        let receipt = self
            .access
            .edit_receipt(&sync.created_by, sync.database_id)
            .await
            .map_err(repository_failure)?
            .ok_or_else(|| {
                failed(
                    SyncFailure::CreatorLostAccess,
                    rootcause::report!("the sync's creator can no longer edit the database"),
                )
            })?;
        let target = Target {
            receipt,
            viewer: Viewer {
                user_id: sync.created_by.clone(),
                acting_bot: None,
            },
            table: sync.table_id,
        };
        let unavailable = || {
            failed(
                SyncFailure::DatabaseUnavailable,
                rootcause::report!("the database or its synced table is gone"),
            )
        };
        let database = self
            .tables
            .database(sync.database_id)
            .await
            .map_err(database_failure)?
            .ok_or_else(unavailable)?;
        let table = database
            .tables
            .into_iter()
            .find(|table| table.id == sync.table_id)
            .ok_or_else(unavailable)?;

        let read = self
            .read_source(&sync.created_by, sync.id, &sync.source)
            .await?;

        let changes = reconcile(
            sync.table_id,
            &columns.columns,
            &columns.detached,
            &table.columns,
            &read.wanted,
        );
        if !changes.ops.is_empty() {
            self.tables
                .apply(target.receipt.clone(), target.viewer.clone(), changes.ops)
                .await
                .map_err(database_failure)?;
        }
        columns.columns = changes.columns;
        columns.detached = changes.detached;

        // A field the source dropped keeps its column and cells, unwritten.
        let wanted_fields: Vec<&SyncField> =
            read.wanted.iter().map(|column| &column.field).collect();
        let written: Vec<&SyncedColumn> = columns
            .columns
            .iter()
            .filter(|column| wanted_fields.contains(&&column.field))
            .collect();
        let rows: Vec<SourceRow> = read
            .items
            .into_iter()
            .map(|item| render(item, &written, &changes.option_ids))
            .collect();

        let mappings = self
            .repository
            .row_mappings(sync.id)
            .await
            .map_err(repository_failure)?;
        let mapped: Vec<RowId> = mappings.iter().map(|mapping| mapping.row_id).collect();
        let present = self
            .tables
            .existing_rows(sync.database_id, sync.table_id, &mapped)
            .await
            .map_err(database_failure)?;
        let planned = plan(&mappings, &present, rows, read.complete);

        let mut counts = RunCounts {
            complete: read.complete,
            ..RunCounts::default()
        };
        for batch in planned.inserts.chunks(BATCH) {
            self.insert_batch(sync, &target, batch, &mut counts).await?;
        }
        for batch in planned.updates.chunks(BATCH) {
            self.update_batch(sync, &target, batch, &mut counts).await?;
        }
        for batch in planned.deletes.chunks(BATCH) {
            self.delete_batch(sync, &target, batch, &mut counts).await?;
        }
        Ok(counts)
    }

    /// Insert rows under reserved ids, then record them. A row the
    /// databases service refuses is left out and tried again next run.
    async fn insert_batch(
        &self,
        sync: &DatabaseSync,
        target: &Target,
        batch: &[RowInsert],
        counts: &mut RunCounts,
    ) -> Result<(), RunFailure> {
        let mut rows: Vec<(&RowInsert, RowId)> = batch
            .iter()
            .map(|insert| (insert, insert.row_id.unwrap_or_else(RowId::new)))
            .collect();
        let reserved: Vec<(String, RowId)> = rows
            .iter()
            .map(|(insert, id)| (insert.external_id.clone(), *id))
            .collect();
        self.repository
            .reserve_rows(sync.id, &reserved)
            .await
            .map_err(repository_failure)?;

        while !rows.is_empty() {
            let op = DatabaseOp::Rows {
                table: target.table,
                change: RowsChange::Insert {
                    rows: rows
                        .iter()
                        .map(|(insert, _)| {
                            insert
                                .cells
                                .iter()
                                .filter(|cell| cell.value != CellValue::Clear)
                                .cloned()
                                .collect()
                        })
                        .collect(),
                    ids: Some(rows.iter().map(|(_, id)| *id).collect()),
                },
            };
            match self
                .tables
                .apply(target.receipt.clone(), target.viewer.clone(), vec![op])
                .await
            {
                Ok(_) => break,
                Err(error) => {
                    let Some(index) = refused_row(&error, rows.len()) else {
                        return Err(database_failure(error));
                    };
                    let (skipped, _) = rows.remove(index);
                    tracing::warn!(error = %error, "a synced row was refused; it is retried next run");
                    self.repository
                        .forget_rows(sync.id, std::slice::from_ref(&skipped.external_id))
                        .await
                        .map_err(repository_failure)?;
                    counts.skipped += 1;
                }
            }
        }

        let recorded: Vec<_> = rows
            .iter()
            .map(|(insert, id)| (insert.external_id.clone(), *id, insert.fingerprint))
            .collect();
        self.repository
            .record_rows(sync.id, &recorded)
            .await
            .map_err(repository_failure)?;
        counts.inserted += recorded.len();
        Ok(())
    }

    /// Rewrite changed rows, then record them. A row the databases service
    /// refuses is left as it was and tried again next run.
    async fn update_batch(
        &self,
        sync: &DatabaseSync,
        target: &Target,
        batch: &[RowUpdate],
        counts: &mut RunCounts,
    ) -> Result<(), RunFailure> {
        let mut rows: Vec<&RowUpdate> = batch.iter().collect();

        while !rows.is_empty() {
            let op = DatabaseOp::Rows {
                table: target.table,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: rows
                            .iter()
                            .map(|update| RowChange {
                                row: update.row_id,
                                cells: update.cells.clone(),
                            })
                            .collect(),
                    },
                },
            };
            match self
                .tables
                .apply(target.receipt.clone(), target.viewer.clone(), vec![op])
                .await
            {
                Ok(_) => break,
                Err(error) => {
                    let Some(index) = refused_row(&error, rows.len()) else {
                        return Err(database_failure(error));
                    };
                    rows.remove(index);
                    tracing::warn!(error = %error, "a synced row was refused; it is retried next run");
                    counts.skipped += 1;
                }
            }
        }

        let recorded: Vec<_> = rows
            .iter()
            .map(|update| {
                (
                    update.external_id.clone(),
                    update.row_id,
                    update.fingerprint,
                )
            })
            .collect();
        self.repository
            .record_rows(sync.id, &recorded)
            .await
            .map_err(repository_failure)?;
        counts.updated += recorded.len();
        Ok(())
    }

    /// Remove the rows of source rows that are gone, then forget them.
    async fn delete_batch(
        &self,
        sync: &DatabaseSync,
        target: &Target,
        batch: &[RowDelete],
        counts: &mut RunCounts,
    ) -> Result<(), RunFailure> {
        let rows: Vec<RowId> = batch.iter().filter_map(|delete| delete.row_id).collect();
        if !rows.is_empty() {
            let op = DatabaseOp::Rows {
                table: target.table,
                change: RowsChange::Delete { rows: rows.clone() },
            };
            self.tables
                .apply(target.receipt.clone(), target.viewer.clone(), vec![op])
                .await
                .map_err(database_failure)?;
        }

        let forgotten: Vec<String> = batch
            .iter()
            .map(|delete| delete.external_id.clone())
            .collect();
        self.repository
            .forget_rows(sync.id, &forgotten)
            .await
            .map_err(repository_failure)?;
        counts.deleted += rows.len();
        Ok(())
    }
}
