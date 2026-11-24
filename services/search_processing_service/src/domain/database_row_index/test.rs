use std::{
    collections::{BTreeMap, HashMap},
    sync::Mutex,
};

use chrono::{TimeZone, Utc};
use uuid::uuid;

use super::*;

const DATABASE: Uuid = uuid!("10000000-0000-7000-8000-000000000001");
const TABLE: Uuid = uuid!("20000000-0000-7000-8000-000000000001");
const ROW_A: Uuid = uuid!("60000000-0000-7000-8000-00000000000a");
const ROW_B: Uuid = uuid!("60000000-0000-7000-8000-00000000000b");
const ROW_C: Uuid = uuid!("60000000-0000-7000-8000-00000000000c");

/// Postgres as a table of rows, its journal and the watermarks.
#[derive(Default)]
struct FakeSource {
    state: Mutex<SourceState>,
}

#[derive(Default)]
struct SourceState {
    /// `None` once the table is gone.
    table: Option<TableState>,
    /// `None` once the database is gone.
    database_searchable: Option<bool>,
    /// The rows that exist, with their text at the table's version.
    rows: BTreeMap<Uuid, String>,
    journal: Vec<(i64, Vec<Uuid>, bool)>,
    watermarks: HashMap<Uuid, (Uuid, i64)>,
}

impl FakeSource {
    fn new(version: i64, rows: &[(Uuid, &str)]) -> Self {
        Self {
            state: Mutex::new(SourceState {
                table: Some(TableState {
                    database_id: DATABASE,
                    version,
                    searchable: true,
                }),
                database_searchable: Some(true),
                rows: rows
                    .iter()
                    .map(|(row_id, title)| (*row_id, (*title).to_owned()))
                    .collect(),
                ..SourceState::default()
            }),
        }
    }

    fn edit(&self, change: impl FnOnce(&mut SourceState)) {
        change(&mut self.state.lock().unwrap());
    }

    fn watermark_of(&self, table_id: Uuid) -> Option<i64> {
        self.state
            .lock()
            .unwrap()
            .watermarks
            .get(&table_id)
            .map(|(_, version)| *version)
    }
}

impl SourceState {
    fn searchable(&self) -> bool {
        self.database_searchable == Some(true)
    }
}

impl DatabaseRowSource for FakeSource {
    type SweepLease = ();

    async fn lead_stale_sweep(&self) -> Result<Option<()>, Report> {
        Ok(Some(()))
    }

    async fn table_state(&self, table_id: Uuid) -> Result<Option<TableState>, Report> {
        let state = self.state.lock().unwrap();
        Ok(state
            .table
            .filter(|_| table_id == TABLE)
            .map(|table| TableState {
                searchable: state.searchable(),
                ..table
            }))
    }

    async fn database_tables(&self, _database_id: Uuid) -> Result<Option<DatabaseTables>, Report> {
        let state = self.state.lock().unwrap();
        Ok(state.database_searchable.map(|searchable| DatabaseTables {
            searchable,
            table_ids: state.table.map(|_| TABLE).into_iter().collect(),
        }))
    }

    async fn table_changes(
        &self,
        _table_id: Uuid,
        after: i64,
        through: i64,
    ) -> Result<TableChanges, Report> {
        let state = self.state.lock().unwrap();
        let in_range: Vec<_> = state
            .journal
            .iter()
            .filter(|(version, _, _)| *version > after && *version <= through)
            .collect();
        Ok(TableChanges {
            versions: in_range.iter().map(|(version, _, _)| *version).collect(),
            row_ids: in_range
                .iter()
                .flat_map(|(_, rows, _)| rows.iter().copied())
                .collect(),
            reshapes_text: in_range.iter().any(|(_, _, reshapes)| *reshapes),
        })
    }

    async fn table_rows(
        &self,
        _table_id: Uuid,
        after: Option<&RowPlace>,
        limit: usize,
    ) -> Result<Vec<RowPlace>, Report> {
        // Every row sits at the same position, so ids order them.
        let state = self.state.lock().unwrap();
        Ok(state
            .rows
            .keys()
            .filter(|row_id| after.is_none_or(|after| **row_id > after.id))
            .take(limit)
            .map(|row_id| RowPlace {
                position: "a".to_owned(),
                id: *row_id,
            })
            .collect())
    }

    async fn row_texts(&self, row_ids: &[Uuid]) -> Result<Vec<RowSearchText>, Report> {
        let state = self.state.lock().unwrap();
        let Some(table) = state.table.filter(|_| state.searchable()) else {
            return Ok(Vec::new());
        };
        Ok(row_ids
            .iter()
            .filter_map(|row_id| {
                state.rows.get(row_id).map(|title| RowSearchText {
                    row_id: *row_id,
                    table_id: TABLE,
                    database_id: DATABASE,
                    title: title.clone(),
                    cell_text: Vec::new(),
                    table_version: table.version,
                    updated_at: Utc.with_ymd_and_hms(2026, 11, 24, 0, 0, 0).unwrap(),
                })
            })
            .collect())
    }

    async fn searchable_database_ids(
        &self,
        after: Option<Uuid>,
        _limit: usize,
    ) -> Result<Vec<Uuid>, Report> {
        let state = self.state.lock().unwrap();
        Ok((state.searchable() && after.is_none())
            .then_some(DATABASE)
            .into_iter()
            .collect())
    }

    async fn searchable_row_ids(&self, row_ids: &[Uuid]) -> Result<Vec<Uuid>, Report> {
        let state = self.state.lock().unwrap();
        Ok(row_ids
            .iter()
            .filter(|row_id| state.searchable() && state.rows.contains_key(row_id))
            .copied()
            .collect())
    }

    async fn watermark(&self, table_id: Uuid) -> Result<Option<i64>, Report> {
        Ok(self.watermark_of(table_id))
    }

    async fn raise_watermark(
        &self,
        table_id: Uuid,
        database_id: Uuid,
        version: i64,
    ) -> Result<(), Report> {
        let mut state = self.state.lock().unwrap();
        let mark = state
            .watermarks
            .entry(table_id)
            .or_insert((database_id, version));
        mark.1 = mark.1.max(version);
        Ok(())
    }

    async fn forget_table(&self, table_id: Uuid) -> Result<(), Report> {
        self.state.lock().unwrap().watermarks.remove(&table_id);
        Ok(())
    }

    async fn forget_database(&self, database_id: Uuid) -> Result<(), Report> {
        self.state
            .lock()
            .unwrap()
            .watermarks
            .retain(|_, (database, _)| *database != database_id);
        Ok(())
    }

    async fn gone_tables(&self, _limit: usize) -> Result<Vec<Uuid>, Report> {
        let state = self.state.lock().unwrap();
        Ok(state
            .watermarks
            .keys()
            .filter(|table_id| state.table.is_none() || **table_id != TABLE)
            .copied()
            .collect())
    }
}

/// The index, with `external_gte` versions and an optional failing write.
#[derive(Default)]
struct FakeIndex {
    documents: Mutex<BTreeMap<Uuid, DatabaseRowDocument>>,
    fail_next_write: Mutex<bool>,
}

impl FakeIndex {
    fn holding(documents: &[(Uuid, &str, i64)]) -> Self {
        let index = Self::default();
        for (row_id, title, table_version) in documents {
            index.documents.lock().unwrap().insert(
                *row_id,
                DatabaseRowDocument {
                    row_id: *row_id,
                    database_id: DATABASE,
                    table_id: TABLE,
                    title: (*title).to_owned(),
                    cell_text: Vec::new(),
                    table_version: *table_version,
                    updated_at: 0,
                },
            );
        }
        index
    }

    /// `(row, title, version)` of every document, in row order.
    fn contents(&self) -> Vec<(Uuid, String, i64)> {
        self.documents
            .lock()
            .unwrap()
            .values()
            .map(|document| {
                (
                    document.row_id,
                    document.title.clone(),
                    document.table_version,
                )
            })
            .collect()
    }
}

impl DatabaseRowIndex for FakeIndex {
    async fn write(&self, writes: Vec<RowIndexWrite>) -> Result<RowWriteOutcome, Report> {
        if std::mem::take(&mut *self.fail_next_write.lock().unwrap()) {
            return Err(Report::new_sendsync(std::io::Error::other("bulk refused")).into_dynamic());
        }
        let mut documents = self.documents.lock().unwrap();
        let mut outcome = RowWriteOutcome::default();
        for write in writes {
            let (row_id, version) = match &write {
                RowIndexWrite::Upsert(document) => (document.row_id, document.table_version),
                RowIndexWrite::Delete {
                    row_id,
                    table_version,
                } => (*row_id, *table_version),
            };
            if documents
                .get(&row_id)
                .is_some_and(|held| held.table_version > version)
            {
                outcome.superseded += 1;
                continue;
            }
            match write {
                RowIndexWrite::Upsert(document) => {
                    documents.insert(row_id, document);
                }
                RowIndexWrite::Delete { .. } => {
                    documents.remove(&row_id);
                }
            }
            outcome.applied += 1;
        }
        Ok(outcome)
    }

    async fn delete(&self, scope: RowIndexScope) -> Result<u64, Report> {
        let mut documents = self.documents.lock().unwrap();
        let before = documents.len();
        documents.retain(|_, document| match scope {
            RowIndexScope::Database(database_id) => document.database_id != database_id,
            RowIndexScope::Table(table_id) => document.table_id != table_id,
            RowIndexScope::TableOlderThan { table_id, version } => {
                document.table_id != table_id || document.table_version >= version
            }
        });
        Ok(u64::try_from(before - documents.len()).unwrap())
    }

    async fn page(&self, after: Option<Uuid>, size: usize) -> Result<Vec<IndexedRow>, Report> {
        Ok(self
            .documents
            .lock()
            .unwrap()
            .values()
            .filter(|document| after.is_none_or(|after| document.row_id > after))
            .take(size)
            .map(|document| IndexedRow {
                row_id: document.row_id,
                table_version: document.table_version,
            })
            .collect())
    }
}

#[tokio::test]
async fn catching_up_rewrites_only_the_rows_the_journal_names() {
    let source = FakeSource::new(
        7,
        &[(ROW_A, "A at 7"), (ROW_B, "B at 7"), (ROW_C, "C at 7")],
    );
    source.edit(|state| {
        state.watermarks.insert(TABLE, (DATABASE, 5));
        state.journal = vec![(6, vec![ROW_A], false), (7, vec![ROW_B], false)];
    });
    let index = FakeIndex::holding(&[
        (ROW_A, "A at 5", 5),
        (ROW_B, "B at 5", 5),
        (ROW_C, "C at 5", 5),
    ]);
    let service = DatabaseRowIndexService::new(source, index);

    let outcome = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();

    assert_eq!(outcome, TableOutcome::CaughtUp);
    assert_eq!(
        service.index.contents(),
        vec![
            (ROW_A, "A at 7".to_owned(), 7),
            (ROW_B, "B at 7".to_owned(), 7),
            (ROW_C, "C at 5".to_owned(), 5),
        ]
    );
    assert_eq!(service.source.watermark_of(TABLE), Some(7));
}

#[tokio::test]
async fn a_row_the_journal_names_that_is_gone_leaves_the_index() {
    let source = FakeSource::new(6, &[(ROW_A, "A at 6")]);
    source.edit(|state| {
        state.watermarks.insert(TABLE, (DATABASE, 5));
        state.journal = vec![(6, vec![ROW_B], false)];
    });
    let index = FakeIndex::holding(&[(ROW_A, "A at 5", 5), (ROW_B, "B at 5", 5)]);
    let service = DatabaseRowIndexService::new(source, index);

    service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();

    assert_eq!(
        service.index.contents(),
        vec![(ROW_A, "A at 5".to_owned(), 5)]
    );
}

#[tokio::test]
async fn a_gap_in_the_journal_reindexes_the_whole_table() {
    // Version 6 is missing from the journal, so its rows are unknown.
    let source = FakeSource::new(7, &[(ROW_A, "A at 7"), (ROW_B, "B at 7")]);
    source.edit(|state| {
        state.watermarks.insert(TABLE, (DATABASE, 5));
        state.journal = vec![(7, vec![ROW_A], false)];
    });
    let index = FakeIndex::holding(&[
        (ROW_A, "A at 5", 5),
        (ROW_B, "B at 5", 5),
        (ROW_C, "C at 5", 5),
    ]);
    let service = DatabaseRowIndexService::new(source, index);

    let outcome = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();

    assert_eq!(outcome, TableOutcome::Reindexed);
    // Every row rewritten, and the row deleted in the missing version gone.
    assert_eq!(
        service.index.contents(),
        vec![
            (ROW_A, "A at 7".to_owned(), 7),
            (ROW_B, "B at 7".to_owned(), 7)
        ]
    );
    assert_eq!(service.source.watermark_of(TABLE), Some(7));
}

#[tokio::test]
async fn a_relabelled_option_reindexes_the_whole_table() {
    let source = FakeSource::new(6, &[(ROW_A, "Shipped"), (ROW_B, "Shipped")]);
    source.edit(|state| {
        state.watermarks.insert(TABLE, (DATABASE, 5));
        state.journal = vec![(6, Vec::new(), true)];
    });
    let index = FakeIndex::holding(&[(ROW_A, "Launched", 5), (ROW_B, "Launched", 5)]);
    let service = DatabaseRowIndexService::new(source, index);

    let outcome = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();

    assert_eq!(outcome, TableOutcome::Reindexed);
    assert_eq!(
        service.index.contents(),
        vec![
            (ROW_A, "Shipped".to_owned(), 6),
            (ROW_B, "Shipped".to_owned(), 6)
        ]
    );
}

#[tokio::test]
async fn an_older_state_read_late_never_overwrites_a_newer_document() {
    // A pass that read version 8 lands after another wrote version 9.
    let source = FakeSource::new(8, &[(ROW_A, "A at 8")]);
    let index = FakeIndex::holding(&[(ROW_A, "A at 9", 9)]);
    let service = DatabaseRowIndexService::new(source, index);

    service
        .reconcile_table(TABLE, PassKind::Full)
        .await
        .unwrap();

    assert_eq!(
        service.index.contents(),
        vec![(ROW_A, "A at 9".to_owned(), 9)]
    );
}

#[tokio::test]
async fn a_replayed_event_changes_nothing() {
    let source = FakeSource::new(6, &[(ROW_A, "A at 6")]);
    source.edit(|state| {
        state.watermarks.insert(TABLE, (DATABASE, 5));
        state.journal = vec![(6, vec![ROW_A], false)];
    });
    let service = DatabaseRowIndexService::new(source, FakeIndex::default());

    let first = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();
    let contents = service.index.contents();
    let replayed = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();

    assert_eq!(first, TableOutcome::CaughtUp);
    assert_eq!(replayed, TableOutcome::UpToDate);
    assert_eq!(service.index.contents(), contents);
}

#[tokio::test]
async fn a_failed_write_leaves_the_watermark_so_the_retry_redoes_it() {
    let source = FakeSource::new(6, &[(ROW_A, "A at 6")]);
    source.edit(|state| {
        state.watermarks.insert(TABLE, (DATABASE, 5));
        state.journal = vec![(6, vec![ROW_A], false)];
    });
    let index = FakeIndex::holding(&[(ROW_A, "A at 5", 5)]);
    *index.fail_next_write.lock().unwrap() = true;
    let service = DatabaseRowIndexService::new(source, index);

    assert!(
        service
            .reconcile_table(TABLE, PassKind::CatchUp)
            .await
            .is_err()
    );
    assert_eq!(service.source.watermark_of(TABLE), Some(5));

    let retried = service
        .reconcile_table(TABLE, PassKind::CatchUp)
        .await
        .unwrap();
    assert_eq!(retried, TableOutcome::CaughtUp);
    assert_eq!(
        service.index.contents(),
        vec![(ROW_A, "A at 6".to_owned(), 6)]
    );
}

#[tokio::test]
async fn trash_removes_the_database_and_restore_brings_it_back() {
    let source = FakeSource::new(6, &[(ROW_A, "A at 6"), (ROW_B, "B at 6")]);
    source.edit(|state| {
        state.watermarks.insert(TABLE, (DATABASE, 6));
        state.database_searchable = Some(false);
    });
    let index = FakeIndex::holding(&[(ROW_A, "A at 6", 6), (ROW_B, "B at 6", 6)]);
    let service = DatabaseRowIndexService::new(source, index);

    service
        .reconcile_database(DATABASE, TableSelection::All, PassKind::CatchUp)
        .await
        .unwrap();
    assert_eq!(service.index.contents(), Vec::new());
    assert_eq!(service.source.watermark_of(TABLE), None);

    // Restored: the forgotten watermark makes the pass reindex every table.
    service
        .source
        .edit(|state| state.database_searchable = Some(true));
    service
        .reconcile_database(DATABASE, TableSelection::All, PassKind::CatchUp)
        .await
        .unwrap();
    assert_eq!(
        service.index.contents(),
        vec![
            (ROW_A, "A at 6".to_owned(), 6),
            (ROW_B, "B at 6".to_owned(), 6)
        ]
    );
}

#[tokio::test]
async fn a_purged_database_leaves_the_index() {
    let source = FakeSource::new(6, &[]);
    source.edit(|state| {
        state.table = None;
        state.database_searchable = None;
        state.watermarks.insert(TABLE, (DATABASE, 6));
    });
    let index = FakeIndex::holding(&[(ROW_A, "A at 6", 6)]);
    let service = DatabaseRowIndexService::new(source, index);

    service
        .reconcile_database(
            DATABASE,
            TableSelection::Tables(vec![TABLE]),
            PassKind::CatchUp,
        )
        .await
        .unwrap();

    assert_eq!(service.index.contents(), Vec::new());
    assert_eq!(service.source.watermark_of(TABLE), None);
}

#[tokio::test]
async fn the_stale_sweep_removes_documents_of_gone_rows_and_tables() {
    let gone_table = uuid!("20000000-0000-7000-8000-0000000000ff");
    let source = FakeSource::new(6, &[(ROW_A, "A at 6")]);
    source.edit(|state| {
        state.watermarks.insert(gone_table, (DATABASE, 3));
    });
    let index = FakeIndex::holding(&[(ROW_A, "A at 6", 6), (ROW_B, "B at 4", 4)]);
    let service = DatabaseRowIndexService::new(source, index);

    let removal = service
        .remove_stale(&CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(
        removal,
        StaleRemoval {
            checked: 2,
            removed: 1,
            gone_tables: 1,
        }
    );
    assert_eq!(
        service.index.contents(),
        vec![(ROW_A, "A at 6".to_owned(), 6)]
    );
    assert_eq!(service.source.watermark_of(gone_table), None);
}
