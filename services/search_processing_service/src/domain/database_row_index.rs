//! Keep the `database_rows` search index in step with Postgres.
//!
//! Events are hints to reread: every pass reads the current state from
//! Postgres, so a delayed, repeated or reordered event can only cause extra
//! work. A table is caught up from its change journal between the version
//! the index holds it at (its watermark) and its current version; a gap in
//! the journal, a column change that rewrites rows' text without naming
//! them, or an unknown watermark reindexes the whole table instead. Every
//! write carries the table version its text was read at, so the index keeps
//! the newest state whatever order writes land in.

use std::{collections::HashSet, sync::Arc, time::Instant};

use chrono::{DateTime, Utc};

use database_row_search::{
    RowSearchText,
    index::{DatabaseTables, RowPlace, TableChanges, TableState},
};
use models_opensearch::database_row::DatabaseRowDocument;
use rootcause::Report;
use serde::Deserialize;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{
    backfill_gate::BackfillGate,
    jobs::JobProgress,
    models::{BackfillError, BackfillReceipt},
};

#[cfg(test)]
mod test;

/// Rows read and written per batch; one shared-text read takes at most this.
const ROWS_PER_BATCH: usize = database_row_search::MAX_ROWS_PER_READ;

/// Above this many versions behind, a table is reindexed whole instead of
/// replaying its journal.
const MAX_JOURNAL_VERSIONS: i64 = 200;

/// Postgres, as the indexer reads it.
pub trait DatabaseRowSource: Send + Sync + 'static {
    /// Held while one task sweeps stale documents; dropping it lets another.
    type SweepLease: Send;

    /// The right to run the stale sweep, or `None` while another task holds it.
    fn lead_stale_sweep(
        &self,
    ) -> impl Future<Output = Result<Option<Self::SweepLease>, Report>> + Send;

    /// The table, or `None` when it no longer exists.
    fn table_state(
        &self,
        table_id: Uuid,
    ) -> impl Future<Output = Result<Option<TableState>, Report>> + Send;

    /// The database's tables, or `None` when its storage no longer exists.
    fn database_tables(
        &self,
        database_id: Uuid,
    ) -> impl Future<Output = Result<Option<DatabaseTables>, Report>> + Send;

    /// The table's journal for versions in `(after, through]`.
    fn table_changes(
        &self,
        table_id: Uuid,
        after: i64,
        through: i64,
    ) -> impl Future<Output = Result<TableChanges, Report>> + Send;

    /// One page of the table's rows in table order, after `after`.
    fn table_rows(
        &self,
        table_id: Uuid,
        after: Option<&RowPlace>,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<RowPlace>, Report>> + Send;

    /// The searchable text of the rows that exist in a searchable database.
    fn row_texts(
        &self,
        row_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<RowSearchText>, Report>> + Send;

    /// One page of searchable database ids in id order.
    fn searchable_database_ids(
        &self,
        after: Option<Uuid>,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Which of `row_ids` exist in a searchable database.
    fn searchable_row_ids(
        &self,
        row_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// The version up to which the index holds the table, if known.
    fn watermark(&self, table_id: Uuid)
    -> impl Future<Output = Result<Option<i64>, Report>> + Send;

    /// Record that the index holds the table up to `version`.
    fn raise_watermark(
        &self,
        table_id: Uuid,
        database_id: Uuid,
        version: i64,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Forget the table's watermark.
    fn forget_table(&self, table_id: Uuid) -> impl Future<Output = Result<(), Report>> + Send;

    /// Forget every watermark of the database.
    fn forget_database(&self, database_id: Uuid)
    -> impl Future<Output = Result<(), Report>> + Send;

    /// One page, in id order, of searchable tables with no watermark or one
    /// below their version.
    fn lagging_tables(
        &self,
        after: Option<Uuid>,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Tables placing a definition whose options changed after `since` and
    /// after the table's watermark last moved.
    fn relabelled_tables(
        &self,
        since: DateTime<Utc>,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Tables with a watermark that no longer exist, at most `limit`.
    fn gone_tables(&self, limit: usize) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
}

/// One change to the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RowIndexWrite {
    /// Index the row, unless a newer version is indexed.
    Upsert(DatabaseRowDocument),
    /// Remove the row, unless a version newer than `table_version` is indexed.
    Delete { row_id: Uuid, table_version: i64 },
}

/// Which documents a scoped delete removes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowIndexScope {
    Database(Uuid),
    Table(Uuid),
    /// The table's documents indexed below `version`.
    TableOlderThan {
        table_id: Uuid,
        version: i64,
    },
}

/// A document as the index holds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IndexedRow {
    pub row_id: Uuid,
    pub table_version: i64,
}

/// What a batch of writes did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RowWriteOutcome {
    pub applied: usize,
    /// Refused because the index holds a newer version.
    pub superseded: usize,
}

/// The `database_rows` index.
pub trait DatabaseRowIndex: Send + Sync + 'static {
    fn write(
        &self,
        writes: Vec<RowIndexWrite>,
    ) -> impl Future<Output = Result<RowWriteOutcome, Report>> + Send;

    /// Remove what `scope` names, returning how many documents went.
    fn delete(&self, scope: RowIndexScope) -> impl Future<Output = Result<u64, Report>> + Send;

    /// One page of indexed rows in row id order.
    fn page(
        &self,
        after: Option<Uuid>,
        size: usize,
    ) -> impl Future<Output = Result<Vec<IndexedRow>, Report>> + Send;
}

/// Which tables of a database a pass covers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableSelection {
    /// Every table the database has now.
    All,
    /// These tables, whether or not they still exist.
    Tables(Vec<Uuid>),
}

/// How a pass treats a table's watermark.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassKind {
    /// Replay the journal from the watermark when it can.
    CatchUp,
    /// Reindex every table whole, as a backfill does.
    Full,
}

/// What a pass did to one table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum TableOutcome {
    /// The index already held the table's current version.
    UpToDate,
    /// The journal's changed rows were rewritten.
    CaughtUp,
    /// Every row was rewritten and stale documents removed.
    Reindexed,
    /// The table or its database is gone or not searchable; its documents
    /// were removed.
    Removed,
}

/// Repair or rebuild the index: selected databases, or every searchable one.
/// Every table is reindexed whole. A run over every database also removes
/// documents whose rows are gone (see [`DatabaseRowIndexService::remove_stale`]).
#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DatabaseRowBackfillRequest {
    pub database_ids: Vec<Uuid>,
}

/// What a stale-document sweep removed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StaleRemoval {
    /// Documents checked.
    pub checked: usize,
    /// Documents of rows gone or no longer searchable, removed.
    pub removed: usize,
    /// Tables gone with a watermark, whose documents and mark were removed.
    pub gone_tables: usize,
}

/// What a catch-up round did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CatchUp {
    /// Lagging tables passed over.
    pub lagging: usize,
    /// Tables reindexed for a relabelled option.
    pub relabelled: usize,
    /// Passes that failed, retried next round.
    pub failed: usize,
}

const DATABASES_PER_PAGE: usize = 100;
const LAGGING_TABLES_PER_PAGE: usize = 100;
const RELABELLED_TABLES_PER_ROUND: usize = 500;
const GONE_TABLES_PER_ROUND: usize = 100;

pub struct DatabaseRowIndexService<S, I> {
    source: S,
    index: I,
}

impl<S, I> DatabaseRowIndexService<S, I> {
    pub fn new(source: S, index: I) -> Self {
        Self { source, index }
    }
}

impl<S: DatabaseRowSource, I: DatabaseRowIndex> DatabaseRowIndexService<S, I> {
    /// Bring the selected tables of a database up to date, or remove the
    /// database's documents when it is gone, trashed, or has no database
    /// entity.
    #[tracing::instrument(
        err,
        skip(self, selection),
        fields(
            tables = tracing::field::Empty,
            searchable = tracing::field::Empty,
        )
    )]
    pub async fn reconcile_database(
        &self,
        database_id: Uuid,
        selection: TableSelection,
        kind: PassKind,
    ) -> Result<(), Report> {
        let span = tracing::Span::current();
        let tables = self.source.database_tables(database_id).await?;
        let searchable = tables.as_ref().is_some_and(|tables| tables.searchable);
        span.record("searchable", searchable);

        let Some(tables) = tables.filter(|tables| tables.searchable) else {
            self.remove_database(database_id).await?;
            return Ok(());
        };

        let table_ids = match selection {
            TableSelection::All => tables.table_ids,
            TableSelection::Tables(table_ids) => table_ids,
        };
        span.record("tables", table_ids.len());

        for table_id in table_ids {
            self.reconcile_table(table_id, kind).await?;
        }
        Ok(())
    }

    /// Bring one table up to date and raise its watermark to the version
    /// read at the start, once every write for it succeeded.
    #[tracing::instrument(
        err,
        skip(self),
        fields(
            database_id = tracing::field::Empty,
            table_version = tracing::field::Empty,
            watermark = tracing::field::Empty,
            outcome = tracing::field::Empty,
            rows_written = tracing::field::Empty,
            rows_deleted = tracing::field::Empty,
            rows_superseded = tracing::field::Empty,
        )
    )]
    pub async fn reconcile_table(
        &self,
        table_id: Uuid,
        kind: PassKind,
    ) -> Result<TableOutcome, Report> {
        let span = tracing::Span::current();
        let outcome = self.reconcile_table_inner(table_id, kind, &span).await?;
        span.record("outcome", <&'static str>::from(outcome));
        Ok(outcome)
    }

    async fn reconcile_table_inner(
        &self,
        table_id: Uuid,
        kind: PassKind,
        span: &tracing::Span,
    ) -> Result<TableOutcome, Report> {
        let Some(state) = self.source.table_state(table_id).await? else {
            self.index.delete(RowIndexScope::Table(table_id)).await?;
            self.source.forget_table(table_id).await?;
            return Ok(TableOutcome::Removed);
        };
        span.record("database_id", tracing::field::display(state.database_id));
        span.record("table_version", state.version);

        if !state.searchable {
            self.remove_database(state.database_id).await?;
            return Ok(TableOutcome::Removed);
        }

        let watermark = match kind {
            PassKind::CatchUp => self.source.watermark(table_id).await?,
            PassKind::Full => None,
        };
        if let Some(watermark) = watermark {
            span.record("watermark", watermark);
        }

        let mut counts = RowCounts::default();
        let outcome = match watermark {
            Some(watermark) if watermark >= state.version => TableOutcome::UpToDate,
            Some(watermark) if state.version - watermark <= MAX_JOURNAL_VERSIONS => {
                let changes = self
                    .source
                    .table_changes(table_id, watermark, state.version)
                    .await?;
                if replayable(&changes, watermark, state.version) {
                    for batch in changes.row_ids.chunks(ROWS_PER_BATCH) {
                        counts += self.rewrite_rows(batch, state.version).await?;
                    }
                    TableOutcome::CaughtUp
                } else {
                    counts = self.reindex_table(table_id, state).await?;
                    TableOutcome::Reindexed
                }
            }
            _ => {
                counts = self.reindex_table(table_id, state).await?;
                TableOutcome::Reindexed
            }
        };

        span.record("rows_written", counts.written);
        span.record("rows_deleted", counts.deleted);
        span.record("rows_superseded", counts.superseded);

        if outcome == TableOutcome::UpToDate {
            return Ok(outcome);
        }

        // A trash, purge or table delete that committed while this pass
        // wrote does not bump the table version, so its deletes and these
        // writes can carry the same version and the writes can land last.
        // Read the table again: if it went, remove what this pass wrote and
        // leave the watermark forgotten.
        if !self.still_searchable(table_id).await? {
            self.remove_table(table_id).await?;
            return Ok(TableOutcome::Removed);
        }
        self.source
            .raise_watermark(table_id, state.database_id, state.version)
            .await?;
        Ok(outcome)
    }

    /// Whether the table still exists in a searchable database.
    async fn still_searchable(&self, table_id: Uuid) -> Result<bool, Report> {
        Ok(self
            .source
            .table_state(table_id)
            .await?
            .is_some_and(|state| state.searchable))
    }

    /// Remove the documents of a table that is gone or no longer searchable,
    /// with its database's when the database itself went.
    async fn remove_table(&self, table_id: Uuid) -> Result<(), Report> {
        match self.source.table_state(table_id).await? {
            Some(state) => self.remove_database(state.database_id).await,
            None => {
                self.index.delete(RowIndexScope::Table(table_id)).await?;
                self.source.forget_table(table_id).await
            }
        }
    }

    /// Rewrite every row of the table, then remove the documents left below
    /// the version read at the start: rows that are gone. A row written
    /// during the pass is at or above that version, so it stays.
    async fn reindex_table(&self, table_id: Uuid, state: TableState) -> Result<RowCounts, Report> {
        let mut counts = RowCounts::default();
        let mut after = None;
        loop {
            let rows = self
                .source
                .table_rows(table_id, after.as_ref(), ROWS_PER_BATCH)
                .await?;
            let row_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
            let Some(last) = rows.into_iter().last() else {
                break;
            };
            counts += self.rewrite_rows(&row_ids, state.version).await?;
            after = Some(last);

            // A long pass stops writing once its database is trashed or the
            // table is gone; the caller removes what it wrote.
            if !self.still_searchable(table_id).await? {
                return Ok(counts);
            }
        }

        let swept = self
            .index
            .delete(RowIndexScope::TableOlderThan {
                table_id,
                version: state.version,
            })
            .await?;
        counts.deleted += usize::try_from(swept).unwrap_or(usize::MAX);
        Ok(counts)
    }

    /// Write the rows' current text, and delete the ones no longer found.
    ///
    /// A missing row is deleted at `missing_at`, a table version read before
    /// the rows were: the row was already gone or is gone since, so no
    /// document can hold it at a later version except one written by a pass
    /// that will also see it go.
    async fn rewrite_rows(&self, row_ids: &[Uuid], missing_at: i64) -> Result<RowCounts, Report> {
        let texts = self.source.row_texts(row_ids).await?;
        let found: HashSet<Uuid> = texts.iter().map(|text| text.row_id).collect();

        let mut writes: Vec<RowIndexWrite> = texts
            .into_iter()
            .map(|text| RowIndexWrite::Upsert(document(text)))
            .collect();
        let written = writes.len();
        writes.extend(
            row_ids
                .iter()
                .filter(|row_id| !found.contains(row_id))
                .map(|row_id| RowIndexWrite::Delete {
                    row_id: *row_id,
                    table_version: missing_at,
                }),
        );
        let deleted = writes.len() - written;

        if writes.is_empty() {
            return Ok(RowCounts::default());
        }
        let outcome = self.index.write(writes).await?;
        Ok(RowCounts {
            written,
            deleted,
            superseded: outcome.superseded,
        })
    }

    /// Remove every document of the database and forget its watermarks, in
    /// that order, so a failure leaves the marks for the retry to redo.
    async fn remove_database(&self, database_id: Uuid) -> Result<(), Report> {
        self.index
            .delete(RowIndexScope::Database(database_id))
            .await?;
        self.source.forget_database(database_id).await
    }

    /// Remove documents whose rows are gone or no longer searchable, and the
    /// documents and watermarks of tables that are gone. Each delete carries
    /// the version the document holds, so a row written again meanwhile
    /// keeps its newer document.
    #[tracing::instrument(
        err,
        skip_all,
        fields(checked, removed, gone_tables, pages, duration_ms)
    )]
    pub async fn remove_stale(&self, cancel: &CancellationToken) -> Result<StaleRemoval, Report> {
        let started = Instant::now();
        let mut removal = StaleRemoval::default();
        let mut pages = 0_usize;
        let mut after = None;
        while !cancel.is_cancelled() {
            let page = self.index.page(after, ROWS_PER_BATCH).await?;
            let Some(last) = page.last() else {
                break;
            };
            after = Some(last.row_id);
            pages += 1;
            removal.checked += page.len();

            let row_ids: Vec<Uuid> = page.iter().map(|row| row.row_id).collect();
            let live: HashSet<Uuid> = self
                .source
                .searchable_row_ids(&row_ids)
                .await?
                .into_iter()
                .collect();
            let deletes: Vec<RowIndexWrite> = page
                .iter()
                .filter(|row| !live.contains(&row.row_id))
                .map(|row| RowIndexWrite::Delete {
                    row_id: row.row_id,
                    table_version: row.table_version,
                })
                .collect();
            if !deletes.is_empty() {
                removal.removed += self.index.write(deletes).await?.applied;
            }
        }

        while !cancel.is_cancelled() {
            let gone = self.source.gone_tables(GONE_TABLES_PER_ROUND).await?;
            if gone.is_empty() {
                break;
            }
            for table_id in gone {
                self.index.delete(RowIndexScope::Table(table_id)).await?;
                self.source.forget_table(table_id).await?;
                removal.gone_tables += 1;
            }
        }

        let span = tracing::Span::current();
        span.record("checked", removal.checked);
        span.record("removed", removal.removed);
        span.record("gone_tables", removal.gone_tables);
        span.record("pages", pages);
        span.record("duration_ms", elapsed_ms(started));
        Ok(removal)
    }

    /// Catch up tables whose events were lost (a watermark missing or below
    /// the table's version), and reindex tables whose options were
    /// relabelled since `relabelled_since` without a databases event (a tag
    /// set changed through the properties service). One table failing does
    /// not stop the others; the next round retries it.
    #[tracing::instrument(err, skip_all, fields(lagging, relabelled, failed, duration_ms))]
    pub async fn catch_up(
        &self,
        relabelled_since: DateTime<Utc>,
        cancel: &CancellationToken,
    ) -> Result<CatchUp, Report> {
        let started = Instant::now();
        let mut catch_up = CatchUp::default();

        let mut after = None;
        while !cancel.is_cancelled() {
            let tables = self
                .source
                .lagging_tables(after, LAGGING_TABLES_PER_PAGE)
                .await?;
            let Some(last) = tables.last().copied() else {
                break;
            };
            after = Some(last);
            for table_id in tables {
                catch_up.lagging += 1;
                if self
                    .reconcile_table(table_id, PassKind::CatchUp)
                    .await
                    .is_err()
                {
                    catch_up.failed += 1;
                }
            }
        }

        if !cancel.is_cancelled() {
            let relabelled = self
                .source
                .relabelled_tables(relabelled_since, RELABELLED_TABLES_PER_ROUND)
                .await?;
            for table_id in relabelled {
                catch_up.relabelled += 1;
                // The table's version did not move, so only a full pass
                // rereads it.
                if self
                    .reconcile_table(table_id, PassKind::Full)
                    .await
                    .is_err()
                {
                    catch_up.failed += 1;
                }
            }
        }

        let span = tracing::Span::current();
        span.record("lagging", catch_up.lagging);
        span.record("relabelled", catch_up.relabelled);
        span.record("failed", catch_up.failed);
        span.record("duration_ms", elapsed_ms(started));
        Ok(catch_up)
    }

    /// One sweep round, unless another task is running one: [`Self::catch_up`],
    /// then [`Self::remove_stale`] when `scan_index` (it walks the whole
    /// index, so it runs less often).
    #[tracing::instrument(err, skip_all, fields(led, scan_index))]
    pub async fn sweep_once(
        &self,
        relabelled_since: DateTime<Utc>,
        scan_index: bool,
        cancel: &CancellationToken,
    ) -> Result<(), Report> {
        let span = tracing::Span::current();
        span.record("scan_index", scan_index);
        let lease = self.source.lead_stale_sweep().await?;
        span.record("led", lease.is_some());
        if lease.is_some() {
            self.catch_up(relabelled_since, cancel).await?;
            if scan_index {
                self.remove_stale(cancel).await?;
            }
        }
        drop(lease);
        Ok(())
    }

    /// Reindex the requested databases, or every searchable one and then
    /// remove stale documents.
    pub async fn backfill(
        &self,
        req: DatabaseRowBackfillRequest,
        gate: &BackfillGate,
        progress: Arc<JobProgress>,
        cancel: CancellationToken,
    ) -> Result<BackfillReceipt, BackfillError> {
        let mut enqueued = 0;
        let reindex = |database_id: Uuid| async move {
            self.reconcile_database(database_id, TableSelection::All, PassKind::Full)
                .await
                .map_err(|error| BackfillError::Index(anyhow::anyhow!("{error:#}")))
        };

        if !req.database_ids.is_empty() {
            let mut seen = HashSet::new();
            for database_id in req.database_ids {
                if !seen.insert(database_id) {
                    continue;
                }
                let _permit = tokio::select! {
                    biased;
                    () = cancel.cancelled() => break,
                    permit = gate.admit() => permit,
                };
                reindex(database_id).await?;
                enqueued += 1;
                progress.add(1).await;
            }
            return Ok(BackfillReceipt {
                enqueued,
                ..BackfillReceipt::default()
            });
        }

        let mut after = None;
        'pages: while !cancel.is_cancelled() {
            let database_ids = self
                .source
                .searchable_database_ids(after, DATABASES_PER_PAGE)
                .await
                .map_err(|error| BackfillError::Source(anyhow::anyhow!("{error:#}")))?;
            if database_ids.is_empty() {
                break;
            }
            for database_id in database_ids {
                let _permit = tokio::select! {
                    biased;
                    () = cancel.cancelled() => break 'pages,
                    permit = gate.admit() => permit,
                };
                reindex(database_id).await?;
                after = Some(database_id);
                enqueued += 1;
                progress.add(1).await;
            }
        }

        if !cancel.is_cancelled() {
            self.remove_stale(&cancel)
                .await
                .map_err(|error| BackfillError::Index(anyhow::anyhow!("{error:#}")))?;
        }
        Ok(BackfillReceipt {
            enqueued,
            ..BackfillReceipt::default()
        })
    }
}

/// Whether the journal covers every version after the watermark, one by
/// one, and names every row whose text could have changed.
fn replayable(changes: &TableChanges, watermark: i64, version: i64) -> bool {
    let contiguous = changes
        .versions
        .iter()
        .copied()
        .eq((watermark + 1)..=version);
    contiguous && !changes.reshapes_text
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn document(text: RowSearchText) -> DatabaseRowDocument {
    DatabaseRowDocument {
        row_id: text.row_id,
        database_id: text.database_id,
        table_id: text.table_id,
        title: text.title,
        cell_text: text.cell_text,
        table_version: text.table_version,
        updated_at: text.updated_at.timestamp_millis(),
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct RowCounts {
    written: usize,
    deleted: usize,
    superseded: usize,
}

impl std::ops::AddAssign for RowCounts {
    fn add_assign(&mut self, other: Self) {
        self.written += other.written;
        self.deleted += other.deleted;
        self.superseded += other.superseded;
    }
}
