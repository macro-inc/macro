//! Calendar range index, fetched-range coverage, and change-stream sync state.

use super::*;
use cache_core::calendar::{
    CALENDAR_PROJECTION_VERSION, CALENDAR_TYPENAME, CalendarCommit, CalendarCommitOutcome,
    CalendarFreshness, CalendarRangeRequest, CalendarRangeRow, CalendarRangeSnapshot,
    CalendarRangeStorage, CalendarSpan, CalendarSpanKind, CalendarSyncState, EVENT_TYPENAME,
    OCCURRENCE_TYPENAME, merge_spans, next_sync_state, parse_watermark, project_calendar_range,
    serialize_watermark,
};
use cache_core::value::CacheValue;

pub(super) const CREATE_SCHEMA: [&str; 5] = [
    "CREATE TABLE calendar_ranges (record_key TEXT PRIMARY KEY, event_key TEXT NOT NULL, link_id TEXT NOT NULL, kind INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, long INTEGER NOT NULL)",
    "CREATE INDEX calendar_ranges_scan_idx ON calendar_ranges(kind, long, start, record_key)",
    "CREATE INDEX calendar_ranges_event_idx ON calendar_ranges(event_key, record_key)",
    "CREATE INDEX calendar_ranges_link_idx ON calendar_ranges(link_id, record_key)",
    "CREATE TABLE calendar_coverage (kind INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, PRIMARY KEY (kind, start))",
];

pub(super) const TABLES: [&str; 2] = ["calendar_coverage", "calendar_ranges"];
pub(super) const NAMED_INDEXES: [&str; 3] = [
    "calendar_ranges_event_idx",
    "calendar_ranges_link_idx",
    "calendar_ranges_scan_idx",
];

const RANGE_UPSERT: &str = "INSERT INTO calendar_ranges (record_key, event_key, link_id, kind, start, end, long) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (record_key) DO UPDATE SET event_key = excluded.event_key, link_id = excluded.link_id, kind = excluded.kind, start = excluded.start, end = excluded.end, long = excluded.long";
const RANGE_DELETE: &str = "DELETE FROM calendar_ranges WHERE record_key = ?1";
// A short row ends at most one short span after it starts, so its start is
// bounded on both sides and the scan stays on the (kind, long, start) prefix.
const RANGE_SHORT: &str = "SELECT record_key, event_key, link_id, kind, start, end FROM calendar_ranges INDEXED BY calendar_ranges_scan_idx WHERE kind = ?1 AND long = 0 AND start >= ?2 AND start < ?3 AND end > ?4";
const RANGE_LONG: &str = "SELECT record_key, event_key, link_id, kind, start, end FROM calendar_ranges INDEXED BY calendar_ranges_scan_idx WHERE kind = ?1 AND long = 1 AND start < ?2 AND end > ?3";
const RANGE_BY_EVENT: &str = "SELECT record_key, event_key, link_id, kind, start, end FROM calendar_ranges INDEXED BY calendar_ranges_event_idx WHERE event_key = ?1";
const RANGE_KEYS_BY_EVENT: &str = "SELECT record_key FROM calendar_ranges INDEXED BY calendar_ranges_event_idx WHERE event_key = ?1";
const RANGE_KEYS_BY_LINK: &str =
    "SELECT record_key FROM calendar_ranges INDEXED BY calendar_ranges_link_idx WHERE link_id = ?1";
const COVERAGE_SELECT: &str =
    "SELECT kind, start, end FROM calendar_coverage WHERE kind = ?1 AND start <= ?3 AND end >= ?2";
const COVERAGE_ALL: &str = "SELECT kind, start, end FROM calendar_coverage";
const COVERAGE_INSERT: &str =
    "INSERT INTO calendar_coverage (kind, start, end) VALUES (?1, ?2, ?3)";
const META_SELECT: &str = "SELECT value FROM meta WHERE key = ?1";
const META_UPSERT: &str = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
const META_DELETE: &str = "DELETE FROM meta WHERE key = ?1";
const WATERMARK_KEY: &str = "calendar_watermark";
const FRESHNESS_KEY: &str = "calendar_freshness";
const PROJECTION_VERSION_KEY: &str = "calendar_projection_version";

pub(super) const VALIDATED_SQL: [&str; 13] = [
    RANGE_UPSERT,
    RANGE_DELETE,
    RANGE_SHORT,
    RANGE_LONG,
    RANGE_BY_EVENT,
    RANGE_KEYS_BY_EVENT,
    RANGE_KEYS_BY_LINK,
    COVERAGE_SELECT,
    COVERAGE_ALL,
    COVERAGE_INSERT,
    META_SELECT,
    META_UPSERT,
    META_DELETE,
];

/// Writes or removes the range row of every occurrence entry, keeping the
/// last entry for a key exactly like the record upsert does.
pub(super) fn write_ranges(
    connection: &Arc<Connection>,
    entries: &[EncodedRecord],
) -> Result<(), TursoStorageError> {
    let mut last = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        if entry.key.typename == OCCURRENCE_TYPENAME {
            last.insert(entry.key.id.as_str(), index);
        }
    }
    if last.is_empty() {
        return Ok(());
    }
    let mut upsert = driver::prepare(connection, RANGE_UPSERT)?;
    let mut delete = driver::prepare(connection, RANGE_DELETE)?;
    let mut indexes = last.into_values().collect::<Vec<_>>();
    indexes.sort_unstable();
    for index in indexes {
        let entry = &entries[index];
        match &entry.calendar_range {
            Some(row) => {
                require_changed(driver::execute_prepared(&mut upsert, row_values(row))?, 1)?;
            }
            None => delete_row(&mut delete, &entity_key_text(&entry.key))?,
        }
    }
    Ok(())
}

/// Removes the range rows of deleted occurrence records.
pub(super) fn delete_ranges(
    connection: &Arc<Connection>,
    keys: &[RecordKey],
) -> Result<(), TursoStorageError> {
    let mut statement = None;
    for key in keys
        .iter()
        .filter(|key| key.typename == OCCURRENCE_TYPENAME)
    {
        let statement = match statement.as_mut() {
            Some(statement) => statement,
            None => statement.insert(driver::prepare(connection, RANGE_DELETE)?),
        };
        delete_row(statement, &entity_key_text(key))?;
    }
    Ok(())
}

/// Removes every calendar row and sync value with the rest of the cache.
pub(super) fn clear(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    driver::execute(connection, "DELETE FROM calendar_ranges", Vec::new())?;
    driver::execute(connection, "DELETE FROM calendar_coverage", Vec::new())?;
    for key in [WATERMARK_KEY, FRESHNESS_KEY] {
        driver::execute(connection, META_DELETE, vec![text(key)])?;
    }
    Ok(())
}

pub(super) fn save_projection_version(
    connection: &Arc<Connection>,
) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        META_UPSERT,
        vec![
            text(PROJECTION_VERSION_KEY),
            text(&CALENDAR_PROJECTION_VERSION.to_string()),
        ],
    )?;
    Ok(())
}

/// Rebuilds the disposable range rows from occurrence records when the
/// projection changed, without touching records, coverage, or sync state.
pub(super) fn ensure_projection_version(
    connection: &Arc<Connection>,
) -> Result<(), TursoStorageError> {
    let versions = driver::query(connection, META_SELECT, vec![text(PROJECTION_VERSION_KEY)])?;
    if let [row] = versions.as_slice()
        && required_text(row, 0)? == CALENDAR_PROJECTION_VERSION.to_string()
    {
        return Ok(());
    }
    driver::write_transaction(connection, || {
        driver::execute(connection, "DELETE FROM calendar_ranges", Vec::new())?;
        let mut upsert = driver::prepare(connection, RANGE_UPSERT)?;
        for_each_record(connection, OCCURRENCE_TYPENAME, |key, record| {
            if let Some(row) = project_calendar_range(key, record) {
                require_changed(driver::execute_prepared(&mut upsert, row_values(&row))?, 1)?;
            }
            Ok(())
        })?;
        save_projection_version(connection)
    })
}

fn for_each_record(
    connection: &Arc<Connection>,
    typename: &str,
    mut visit: impl FnMut(&EntityKey<'static>, &Record) -> Result<(), TursoStorageError>,
) -> Result<(), TursoStorageError> {
    let mut last_id: Option<String> = None;
    loop {
        let (sql, parameters) = match last_id.as_ref() {
            Some(id) => (
                SEARCH_REBUILD_RECORDS_AFTER,
                vec![
                    text(typename),
                    text(id),
                    Value::from_i64(SEARCH_REBUILD_BATCH_SIZE),
                ],
            ),
            None => (
                SEARCH_REBUILD_RECORDS,
                vec![text(typename), Value::from_i64(SEARCH_REBUILD_BATCH_SIZE)],
            ),
        };
        let rows = driver::query(connection, sql, parameters)?;
        if rows.is_empty() {
            return Ok(());
        }
        for row in rows {
            let key = RecordKey {
                typename: typename.to_owned(),
                id: required_text(&row, 0)?,
            };
            let record = decode_record(&required_blob(&row, 1)?)
                .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Codec))?;
            last_id = Some(key.id.clone());
            visit(&key.into_entity()?, &record)?;
        }
    }
}

fn row_values(row: &CalendarRangeRow) -> Vec<Value> {
    vec![
        text(row.record_key.as_ref()),
        text(row.event_key.as_ref()),
        text(&row.link_id),
        Value::from_i64(row.span.kind.code()),
        Value::from_i64(row.span.start),
        Value::from_i64(row.span.end),
        Value::from_i64(i64::from(row.is_long())),
    ]
}

fn delete_row(statement: &mut turso_core::Statement, key: &str) -> Result<(), TursoStorageError> {
    let changed = driver::execute_prepared(statement, vec![text(key)])?;
    if (0..=1).contains(&changed) {
        Ok(())
    } else {
        Err(invariant())
    }
}

fn entity_key_text(key: &RecordKey) -> String {
    format!("{}:{}", key.typename, key.id)
}

fn parse_row(row: &[Value]) -> Result<CalendarRangeRow, TursoStorageError> {
    if row.len() != 6 {
        return Err(invariant());
    }
    let entity = |index| -> Result<EntityKey<'static>, TursoStorageError> {
        let value = required_text(row, index)?;
        RecordKey::from_entity(&EntityKey(value.as_str().into()))
            .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Corruption))?
            .into_entity()
    };
    Ok(CalendarRangeRow {
        record_key: entity(0)?,
        event_key: entity(1)?,
        link_id: required_text(row, 2)?,
        span: CalendarSpan {
            kind: CalendarSpanKind::from_code(required_i64(row, 3)?).ok_or_else(invariant)?,
            start: required_i64(row, 4)?,
            end: required_i64(row, 5)?,
        },
    })
}

fn parse_span(row: &[Value]) -> Result<CalendarSpan, TursoStorageError> {
    if row.len() != 3 {
        return Err(invariant());
    }
    Ok(CalendarSpan {
        kind: CalendarSpanKind::from_code(required_i64(row, 0)?).ok_or_else(invariant)?,
        start: required_i64(row, 1)?,
        end: required_i64(row, 2)?,
    })
}

fn load_sync_state(connection: &Arc<Connection>) -> Result<CalendarSyncState, TursoStorageError> {
    let value = |key: &str| -> Result<Option<String>, TursoStorageError> {
        match driver::query(connection, META_SELECT, vec![text(key)])?.as_slice() {
            [] => Ok(None),
            [row] => required_text(row, 0).map(Some),
            _ => Err(invariant()),
        }
    };
    let watermark = value(WATERMARK_KEY)?
        .map(|value| parse_watermark(&value).ok_or_else(invariant))
        .transpose()?;
    let freshness = value(FRESHNESS_KEY)?
        .map(|value| CalendarFreshness::parse(&value).ok_or_else(invariant))
        .transpose()?
        .unwrap_or_default();
    Ok(CalendarSyncState {
        watermark,
        freshness,
    })
}

fn save_sync_state(
    connection: &Arc<Connection>,
    state: &CalendarSyncState,
) -> Result<(), TursoStorageError> {
    match &state.watermark {
        Some(watermark) => driver::execute(
            connection,
            META_UPSERT,
            vec![text(WATERMARK_KEY), text(&serialize_watermark(watermark))],
        )?,
        None => driver::execute(connection, META_DELETE, vec![text(WATERMARK_KEY)])?,
    };
    match state.freshness {
        CalendarFreshness::Unknown => {
            driver::execute(connection, META_DELETE, vec![text(FRESHNESS_KEY)])?
        }
        freshness => driver::execute(
            connection,
            META_UPSERT,
            vec![text(FRESHNESS_KEY), text(freshness.as_str())],
        )?,
    };
    Ok(())
}

fn query_rows(
    connection: &Arc<Connection>,
    request: &CalendarRangeRequest,
) -> Result<Vec<CalendarRangeRow>, TursoStorageError> {
    let rows = match &request.event_key {
        Some(event_key) => {
            driver::query(connection, RANGE_BY_EVENT, vec![text(event_key.as_ref())])?
        }
        None => {
            let mut rows = Vec::new();
            for span in request
                .spans()
                .into_iter()
                .filter(|span| span.end > span.start)
            {
                let kind = Value::from_i64(span.kind.code());
                rows.extend(driver::query(
                    connection,
                    RANGE_SHORT,
                    vec![
                        kind.clone(),
                        Value::from_i64(span.start.saturating_sub(span.kind.max_short_span())),
                        Value::from_i64(span.end),
                        Value::from_i64(span.start),
                    ],
                )?);
                rows.extend(driver::query(
                    connection,
                    RANGE_LONG,
                    vec![kind, Value::from_i64(span.end), Value::from_i64(span.start)],
                )?);
            }
            rows
        }
    };
    let mut parsed = Vec::with_capacity(rows.len());
    for row in rows {
        let row = parse_row(&row)?;
        if request.includes(&row) {
            parsed.push(row);
        }
    }
    Ok(parsed)
}

fn query_coverage(
    connection: &Arc<Connection>,
    request: &CalendarRangeRequest,
) -> Result<Vec<CalendarSpan>, TursoStorageError> {
    let mut coverage = Vec::new();
    for span in request.spans() {
        for row in driver::query(
            connection,
            COVERAGE_SELECT,
            vec![
                Value::from_i64(span.kind.code()),
                Value::from_i64(span.start),
                Value::from_i64(span.end),
            ],
        )? {
            coverage.push(parse_span(&row)?);
        }
    }
    Ok(coverage)
}

fn record_keys(
    connection: &Arc<Connection>,
    sql: &str,
    value: &str,
) -> Result<Vec<String>, TursoStorageError> {
    driver::query(connection, sql, vec![text(value)])?
        .iter()
        .map(|row| required_text(row, 0))
        .collect()
}

fn collect_deleted_keys(
    connection: &Arc<Connection>,
    commit: &CalendarCommit,
) -> Result<BTreeSet<String>, TursoStorageError> {
    let mut deleted = BTreeSet::new();
    for event in &commit.replaced_events {
        let current = event
            .occurrence_keys
            .iter()
            .map(|key| key.as_ref())
            .collect::<BTreeSet<_>>();
        deleted.extend(
            record_keys(connection, RANGE_KEYS_BY_EVENT, event.event_key.as_ref())?
                .into_iter()
                .filter(|key| !current.contains(key.as_str())),
        );
    }
    for event_key in &commit.deleted_event_keys {
        deleted.insert(event_key.as_ref().to_owned());
        deleted.extend(record_keys(
            connection,
            RANGE_KEYS_BY_EVENT,
            event_key.as_ref(),
        )?);
    }
    deleted.extend(
        commit
            .deleted_calendar_keys
            .iter()
            .map(|key| key.as_ref().to_owned()),
    );
    if !commit.removed_link_ids.is_empty() {
        let removed = commit
            .removed_link_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        for link_id in &removed {
            deleted.extend(record_keys(connection, RANGE_KEYS_BY_LINK, link_id)?);
        }
        for typename in [EVENT_TYPENAME, CALENDAR_TYPENAME] {
            for_each_record(connection, typename, |key, record| {
                if matches!(
                    record.fields.get("linkId"),
                    Some(CacheValue::String(link_id)) if removed.contains(link_id.as_str())
                ) {
                    deleted.insert(key.as_ref().to_owned());
                }
                Ok(())
            })?;
        }
    }
    Ok(deleted)
}

fn reset_records(connection: &Arc<Connection>) -> Result<Vec<String>, TursoStorageError> {
    let mut deleted = Vec::new();
    for typename in [OCCURRENCE_TYPENAME, EVENT_TYPENAME] {
        for row in driver::query(
            connection,
            "SELECT id FROM records WHERE __typename = ?1",
            vec![text(typename)],
        )? {
            deleted.push(format!("{typename}:{}", required_text(&row, 0)?));
        }
        driver::execute(
            connection,
            "DELETE FROM records WHERE __typename = ?1",
            vec![text(typename)],
        )?;
    }
    driver::execute(connection, "DELETE FROM calendar_ranges", Vec::new())?;
    driver::execute(connection, "DELETE FROM calendar_coverage", Vec::new())?;
    Ok(deleted)
}

fn apply_commit(
    connection: &Arc<Connection>,
    commit: &CalendarCommit,
) -> Result<CalendarCommitOutcome, TursoStorageError> {
    let mut deleted_keys = if commit.reset {
        reset_records(connection)?
    } else {
        Vec::new()
    };
    let doomed = collect_deleted_keys(connection, commit)?
        .into_iter()
        .map(|key| RecordKey::from_entity(&EntityKey(key.into())))
        .collect::<Result<Vec<_>, _>>()?;
    {
        let mut record_statement = driver::prepare(connection, RECORD_DELETE)?;
        for key in &doomed {
            match driver::execute_prepared(
                &mut record_statement,
                vec![text(&key.typename), text(&key.id)],
            )? {
                0 => {}
                1 => deleted_keys.push(entity_key_text(key)),
                _ => return Err(invariant()),
            }
        }
    }
    delete_ranges(connection, &doomed)?;

    if !commit.coverage.is_empty() {
        let mut coverage = driver::query(connection, COVERAGE_ALL, Vec::new())?
            .iter()
            .map(|row| parse_span(row))
            .collect::<Result<Vec<_>, _>>()?;
        coverage.extend(commit.coverage.iter().copied());
        driver::execute(connection, "DELETE FROM calendar_coverage", Vec::new())?;
        let mut insert = driver::prepare(connection, COVERAGE_INSERT)?;
        for span in merge_spans(coverage) {
            require_changed(
                driver::execute_prepared(
                    &mut insert,
                    vec![
                        Value::from_i64(span.kind.code()),
                        Value::from_i64(span.start),
                        Value::from_i64(span.end),
                    ],
                )?,
                1,
            )?;
        }
    }

    let stored = load_sync_state(connection)?;
    let next = next_sync_state(&stored, commit);
    if next != stored {
        save_sync_state(connection, &next)?;
    }
    deleted_keys.sort();
    deleted_keys.dedup();
    deleted_keys
        .into_iter()
        .map(|key| {
            RecordKey::from_entity(&EntityKey(key.into()))
                .map_err(|_| invariant())?
                .into_entity()
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|deleted_keys| CalendarCommitOutcome { deleted_keys })
}

impl CalendarRangeStorage for TursoStorage {
    async fn query_calendar_ranges(
        &self,
        request: &CalendarRangeRequest,
    ) -> Result<CalendarRangeSnapshot, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            Ok(CalendarRangeSnapshot {
                rows: query_rows(&connection, request)?,
                coverage: query_coverage(&connection, request)?,
                sync: load_sync_state(&connection)?,
            })
        });
        self.latch_result(result)
    }

    async fn calendar_commit(
        &mut self,
        commit: &CalendarCommit,
    ) -> Result<CalendarCommitOutcome, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            commit
                .validate()
                .map_err(|_| TursoStorageError::InvalidInput)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || apply_commit(&connection, commit))
        })();
        self.latch_result(result)
    }
}

/// Validates the frozen calendar tables, their columns, and every index.
pub(super) fn validate_schema(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let column = |name, declared_type, not_null, primary_key_position| ColumnSpec {
        name,
        declared_type,
        not_null,
        default_zero: false,
        primary_key_position,
    };
    validate_table_columns(
        connection,
        "calendar_ranges",
        &[
            column("record_key", "TEXT", false, 1),
            column("event_key", "TEXT", true, 0),
            column("link_id", "TEXT", true, 0),
            column("kind", "INTEGER", true, 0),
            column("start", "INTEGER", true, 0),
            column("end", "INTEGER", true, 0),
            column("long", "INTEGER", true, 0),
        ],
    )?;
    validate_table_columns(
        connection,
        "calendar_coverage",
        &[
            column("kind", "INTEGER", true, 1),
            column("start", "INTEGER", true, 2),
            column("end", "INTEGER", true, 0),
        ],
    )?;
    validate_table_indexes(
        connection,
        "calendar_coverage",
        &[(0, "kind"), (1, "start")],
    )?;
    let indexes = driver::query(
        connection,
        "PRAGMA index_list('calendar_ranges')",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let expected = [
        (
            "calendar_ranges_scan_idx",
            &["kind", "long", "start", "record_key"][..],
        ),
        (
            "calendar_ranges_event_idx",
            &["event_key", "record_key"][..],
        ),
        ("calendar_ranges_link_idx", &["link_id", "record_key"][..]),
    ];
    if indexes.len() != expected.len() + 1
        || !indexes.iter().any(|row| {
            row.len() == 5
                && required_i64(row, 2).ok() == Some(1)
                && required_text(row, 3).ok().as_deref() == Some("pk")
        })
    {
        return Err(compatibility());
    }
    for (index, expected_columns) in expected {
        let Some(row) = indexes
            .iter()
            .find(|row| required_text(row, 1).ok().as_deref() == Some(index))
        else {
            return Err(compatibility());
        };
        if row.len() != 5
            || required_i64(row, 2).ok() != Some(0)
            || required_text(row, 3).ok().as_deref() != Some("c")
        {
            return Err(compatibility());
        }
        let columns = driver::query(
            connection,
            &format!("PRAGMA index_info('{index}')"),
            Vec::new(),
        )
        .map_err(TursoStorageError::initialization)?;
        if columns.len() != expected_columns.len()
            || columns.iter().zip(expected_columns).enumerate().any(
                |(position, (row, expected))| {
                    row.len() != 3
                        || required_i64(row, 0).ok() != i64::try_from(position).ok()
                        || required_text(row, 2).ok().as_deref() != Some(*expected)
                },
            )
        {
            return Err(compatibility());
        }
    }
    for table in TABLES {
        validate_table_constraints(connection, table, false)?;
        validate_no_foreign_keys(connection, table)?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
