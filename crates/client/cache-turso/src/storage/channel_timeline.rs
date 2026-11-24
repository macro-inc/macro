//! Channel timeline index, fetched-stretch coverage, tombstones, and
//! per-channel sync state.

use super::*;
use cache_core::channel_timeline::{
    ACTIVITY_TYPENAME, CHANNEL_TIMELINE_PROJECTION_VERSION, ChannelEntryState, ChannelEviction,
    ChannelEvictionOutcome, ChannelSync, ChannelTimelineRequest, ChannelTimelineRow,
    ChannelTimelineSnapshot, ChannelTimelineStats, ChannelTimelineStorage, MESSAGE_TYPENAME,
    TimelineScope, TimelineSpan, anchor_root_key, plan_window, project_channel_timeline,
};

pub(super) const CREATE_SCHEMA: [&str; 7] = [
    "CREATE TABLE channel_timeline (record_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL, scope TEXT NOT NULL, sort_key TEXT NOT NULL, hidden INTEGER NOT NULL, seq INTEGER NOT NULL)",
    "CREATE INDEX channel_timeline_scan_idx ON channel_timeline(scope, hidden, sort_key, record_key)",
    "CREATE INDEX channel_timeline_channel_idx ON channel_timeline(channel_id, record_key)",
    "CREATE TABLE channel_removed (record_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL, seq INTEGER NOT NULL)",
    "CREATE INDEX channel_removed_channel_idx ON channel_removed(channel_id, seq, record_key)",
    "CREATE TABLE channel_coverage (channel_id TEXT NOT NULL, scope TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, PRIMARY KEY (channel_id, scope, start))",
    "CREATE TABLE channel_sync (channel_id TEXT PRIMARY KEY, seq INTEGER, touched_at_ms INTEGER NOT NULL)",
];

pub(super) const TABLES: [&str; 4] = [
    "channel_coverage",
    "channel_removed",
    "channel_sync",
    "channel_timeline",
];
pub(super) const NAMED_INDEXES: [&str; 3] = [
    "channel_removed_channel_idx",
    "channel_timeline_channel_idx",
    "channel_timeline_scan_idx",
];

const ROW_UPSERT_PREFIX: &str =
    "INSERT INTO channel_timeline (record_key, channel_id, scope, sort_key, hidden, seq) VALUES ";
const ROW_UPSERT_SUFFIX: &str = " ON CONFLICT (record_key) DO UPDATE SET channel_id = excluded.channel_id, scope = excluded.scope, sort_key = excluded.sort_key, hidden = excluded.hidden, seq = excluded.seq";
const ROW_UPDATE: &str = "UPDATE channel_timeline SET channel_id = ?2, scope = ?3, sort_key = ?4, hidden = ?5 WHERE record_key = ?1";
const ROW_DELETE: &str = "DELETE FROM channel_timeline WHERE record_key = ?1";
const ROW_BY_KEY: &str = "SELECT record_key, channel_id, scope, sort_key, hidden, seq FROM channel_timeline WHERE record_key = ?1";
const ALL_ROWS: &str =
    "SELECT record_key, channel_id, scope, sort_key, hidden, seq FROM channel_timeline";
// Both page reads stay on the (scope, hidden, sort_key) prefix and stop at
// the limit, so a page costs the same in a 50-message and a 50,000-message
// channel.
const ROWS_OLDER: &str = "SELECT record_key, sort_key FROM channel_timeline INDEXED BY channel_timeline_scan_idx WHERE scope = ?1 AND hidden = 0 AND sort_key >= ?2 AND sort_key < ?3 ORDER BY sort_key DESC LIMIT ?4";
const ROWS_NEWER: &str = "SELECT record_key, sort_key FROM channel_timeline INDEXED BY channel_timeline_scan_idx WHERE scope = ?1 AND hidden = 0 AND sort_key > ?2 AND sort_key <= ?3 ORDER BY sort_key ASC LIMIT ?4";
const KEYS_BY_SCOPE: &str = "SELECT record_key FROM channel_timeline INDEXED BY channel_timeline_scan_idx WHERE scope = ?1 AND channel_id = ?2";
const KEYS_BY_CHANNEL: &str = "SELECT record_key FROM channel_timeline INDEXED BY channel_timeline_channel_idx WHERE channel_id = ?1";
// Runs when a channel's watermark is first set, over what previews and live
// frames left of it.
const KEYS_BELOW: &str = "SELECT record_key FROM channel_timeline INDEXED BY channel_timeline_channel_idx WHERE channel_id = ?1 AND seq < ?2";
const REMOVED_UPSERT_PREFIX: &str =
    "INSERT INTO channel_removed (record_key, channel_id, seq) VALUES ";
const REMOVED_UPSERT_SUFFIX: &str =
    " ON CONFLICT (record_key) DO UPDATE SET channel_id = excluded.channel_id, seq = excluded.seq";
const REMOVED_DELETE: &str = "DELETE FROM channel_removed WHERE record_key = ?1";
const REMOVED_BY_CHANNEL: &str = "SELECT record_key FROM channel_removed INDEXED BY channel_removed_channel_idx WHERE channel_id = ?1";
const REMOVED_THROUGH: &str = "SELECT record_key FROM channel_removed INDEXED BY channel_removed_channel_idx WHERE channel_id = ?1 AND seq <= ?2";
const COVERAGE_SELECT: &str =
    "SELECT start, end FROM channel_coverage WHERE channel_id = ?1 AND scope = ?2";
const COVERAGE_INSERT: &str =
    "INSERT INTO channel_coverage (channel_id, scope, start, end) VALUES (?1, ?2, ?3, ?4)";
const COVERAGE_DELETE_SCOPE: &str =
    "DELETE FROM channel_coverage WHERE channel_id = ?1 AND scope = ?2";
const COVERAGE_DELETE_CHANNEL: &str = "DELETE FROM channel_coverage WHERE channel_id = ?1";
const SYNC_SELECT: &str = "SELECT seq, touched_at_ms FROM channel_sync WHERE channel_id = ?1";
const SYNC_UPSERT: &str = "INSERT INTO channel_sync (channel_id, seq, touched_at_ms) VALUES (?1, ?2, ?3) ON CONFLICT (channel_id) DO UPDATE SET seq = excluded.seq, touched_at_ms = excluded.touched_at_ms";
const SYNC_ENSURE: &str = "INSERT INTO channel_sync (channel_id, seq, touched_at_ms) VALUES (?1, NULL, 0) ON CONFLICT DO NOTHING";
const SYNC_DELETE: &str = "DELETE FROM channel_sync WHERE channel_id = ?1";
// One row per channel the device holds: small enough to scan.
const SYNC_STALE: &str = "SELECT channel_id FROM channel_sync WHERE touched_at_ms < ?1 ORDER BY touched_at_ms ASC, channel_id ASC LIMIT ?2";
const SYNC_COUNT: &str = "SELECT COUNT(*) FROM channel_sync";
const ROW_COUNT: &str = "SELECT COUNT(*) FROM channel_timeline";
const META_SELECT: &str = "SELECT value FROM meta WHERE key = ?1";
const META_UPSERT: &str = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
pub(super) const PROJECTION_VERSION_KEY: &str = "channel_timeline_projection_version";

/// Keys one statement looks up.
const LOOKUP_BATCH: usize = 64;

pub(super) const VALIDATED_SQL: [&str; 24] = [
    ROW_UPDATE,
    ROW_DELETE,
    ROW_BY_KEY,
    ALL_ROWS,
    ROWS_OLDER,
    ROWS_NEWER,
    KEYS_BY_SCOPE,
    KEYS_BY_CHANNEL,
    KEYS_BELOW,
    REMOVED_DELETE,
    REMOVED_BY_CHANNEL,
    REMOVED_THROUGH,
    COVERAGE_SELECT,
    COVERAGE_INSERT,
    COVERAGE_DELETE_SCOPE,
    COVERAGE_DELETE_CHANNEL,
    SYNC_SELECT,
    SYNC_UPSERT,
    SYNC_ENSURE,
    SYNC_DELETE,
    SYNC_STALE,
    SYNC_COUNT,
    ROW_COUNT,
    META_UPSERT,
];

fn is_entry(typename: &str) -> bool {
    typename == MESSAGE_TYPENAME || typename == ACTIVITY_TYPENAME
}

/// A stored row with the sequence of the write that stored it.
struct HeldRow {
    row: ChannelTimelineRow,
    seq: i64,
}

/// What a message or activity record projects to.
pub(super) enum Entry {
    /// Its timeline row.
    Row(ChannelTimelineRow),
    /// It was deleted.
    Deleted,
    /// It is no timeline entry.
    Unprojectable,
}

impl Entry {
    /// The projection of a message or activity record; `None` for any other.
    pub(super) fn project(key: &EntityKey<'_>, record: &Record) -> Option<Self> {
        if !key.typename().is_some_and(is_entry) {
            return None;
        }
        Some(match project_channel_timeline(key, record) {
            Some(row) => Self::Row(row),
            None if record.fields.get(cache_core::identity::DELETED_FIELD)
                == Some(&cache_core::value::CacheValue::Bool(true)) =>
            {
                Self::Deleted
            }
            None => Self::Unprojectable,
        })
    }
}

/// Keeps the rows of written message and activity records current, keeping
/// the last entry for a key exactly like the record upsert does. Only
/// [`apply`] makes a row: a record of an entry without one has no known
/// sequence.
pub(super) fn write_rows(
    connection: &Db,
    entries: &[EncodedRecord],
) -> Result<(), TursoStorageError> {
    let mut last = BTreeMap::new();
    for entry in entries {
        if let Some(projected) = &entry.channel_timeline {
            last.insert(entity_key_text(&entry.key), projected);
        }
    }
    if last.is_empty() {
        return Ok(());
    }
    for held in held_rows(connection, &last.keys().cloned().collect::<Vec<_>>())? {
        let Some(projected) = last.get(held.row.record_key.as_ref()) else {
            return Err(invariant());
        };
        match projected {
            Entry::Row(row) if *row == held.row => {}
            Entry::Row(row) => {
                require_changed(driver::execute(connection, ROW_UPDATE, row_values(row))?, 1)?;
            }
            Entry::Deleted => {
                let channel_id = held.row.channel_id.as_str();
                let watermark = load_sync(connection, channel_id)?.and_then(|sync| sync.seq);
                let seq = watermark.map_or(held.seq, |watermark| watermark.max(held.seq));
                delete_key(connection, ROW_DELETE, held.row.record_key.as_ref())?;
                insert_rows(
                    connection,
                    REMOVED_UPSERT_PREFIX,
                    REMOVED_UPSERT_SUFFIX,
                    3,
                    vec![
                        text(held.row.record_key.as_ref()),
                        text(channel_id),
                        Value::from_i64(seq),
                    ],
                )?;
            }
            Entry::Unprojectable => drop_row(connection, &held.row)?,
        }
    }
    Ok(())
}

/// Removes the timeline rows of message and activity records deleted for a
/// reason the channel's changes do not explain.
pub(super) fn delete_rows(connection: &Db, keys: &[RecordKey]) -> Result<(), TursoStorageError> {
    let keys = keys
        .iter()
        .filter(|key| is_entry(&key.typename))
        .map(entity_key_text)
        .collect::<Vec<_>>();
    for held in held_rows(connection, &keys)? {
        drop_row(connection, &held.row)?;
    }
    Ok(())
}

/// Deletes a row outside a channel write. The list it was in lacks an entry
/// from now on, so its coverage goes too.
fn drop_row(connection: &Db, row: &ChannelTimelineRow) -> Result<(), TursoStorageError> {
    delete_key(connection, ROW_DELETE, row.record_key.as_ref())?;
    driver::execute(
        connection,
        COVERAGE_DELETE_SCOPE,
        vec![text(&row.channel_id), text(&row.scope.storage_key())],
    )?;
    Ok(())
}

/// Removes every timeline row, tombstone, stretch and sync row with the rest
/// of the cache.
pub(super) fn clear(connection: &Db) -> Result<(), TursoStorageError> {
    for table in TABLES {
        driver::execute(connection, &format!("DELETE FROM {table}"), Vec::new())?;
    }
    Ok(())
}

pub(super) fn save_projection_version(connection: &Db) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        META_UPSERT,
        vec![
            text(PROJECTION_VERSION_KEY),
            text(&CHANNEL_TIMELINE_PROJECTION_VERSION.to_string()),
        ],
    )?;
    Ok(())
}

/// Projects the stored rows again from their records when the projection
/// changed, keeping their sequences. A row that no longer projects takes the
/// coverage of its list with it; records, tombstones and sync state stay.
pub(super) fn ensure_projection_version(connection: &Db) -> Result<(), TursoStorageError> {
    let versions = driver::query(connection, META_SELECT, vec![text(PROJECTION_VERSION_KEY)])?;
    if let [row] = versions.as_slice()
        && required_text(row, 0)? == CHANNEL_TIMELINE_PROJECTION_VERSION.to_string()
    {
        return Ok(());
    }
    driver::write_transaction(connection, || {
        let mut held = driver::query(connection, ALL_ROWS, Vec::new())?
            .iter()
            .map(|row| {
                let held = parse_row(row)?;
                Ok((held.row.record_key.clone(), held.row))
            })
            .collect::<Result<BTreeMap<_, _>, TursoStorageError>>()?;
        if !held.is_empty() {
            for typename in [MESSAGE_TYPENAME, ACTIVITY_TYPENAME] {
                for_each_record(connection, typename, |key, record| {
                    let key = key.clone().into_owned();
                    if held.contains_key(&key)
                        && let Some(row) = project_channel_timeline(&key, record)
                    {
                        held.remove(&key);
                        require_changed(
                            driver::execute(connection, ROW_UPDATE, row_values(&row))?,
                            1,
                        )?;
                    }
                    Ok(())
                })?;
            }
        }
        for row in held.values() {
            drop_row(connection, row)?;
        }
        save_projection_version(connection)
    })
}

fn row_values(row: &ChannelTimelineRow) -> Vec<Value> {
    vec![
        text(row.record_key.as_ref()),
        text(&row.channel_id),
        text(&row.scope.storage_key()),
        text(&row.sort_key),
        Value::from_i64(i64::from(row.hidden)),
    ]
}

/// Deletes at most the one row `sql` finds by record key.
fn delete_key(connection: &Db, sql: &str, key: &str) -> Result<(), TursoStorageError> {
    match driver::execute(connection, sql, vec![text(key)])? {
        0 | 1 => Ok(()),
        _ => Err(invariant()),
    }
}

fn entity_key_text(key: &RecordKey) -> String {
    format!("{}:{}", key.typename, key.id)
}

fn parse_entity(value: String) -> Result<EntityKey<'static>, TursoStorageError> {
    record_key(value)?.into_entity()
}

fn record_key(value: String) -> Result<RecordKey, TursoStorageError> {
    RecordKey::from_entity(&EntityKey(value.into()))
        .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Corruption))
}

fn parse_scope(value: &str) -> Result<TimelineScope, TursoStorageError> {
    match value.split_at_checked(2) {
        Some(("c:", channel_id)) => Ok(TimelineScope::Channel(channel_id.to_owned())),
        Some(("t:", root_id)) => Ok(TimelineScope::Thread(root_id.to_owned())),
        _ => Err(invariant()),
    }
}

fn parse_row(row: &[Value]) -> Result<HeldRow, TursoStorageError> {
    if row.len() != 6 {
        return Err(invariant());
    }
    Ok(HeldRow {
        row: ChannelTimelineRow {
            record_key: parse_entity(required_text(row, 0)?)?,
            channel_id: required_text(row, 1)?,
            scope: parse_scope(&required_text(row, 2)?)?,
            sort_key: required_text(row, 3)?,
            hidden: required_i64(row, 4)? != 0,
        },
        seq: required_i64(row, 5)?,
    })
}

fn row_by_key(
    connection: &Db,
    key: &EntityKey<'_>,
) -> Result<Option<ChannelTimelineRow>, TursoStorageError> {
    match driver::query(connection, ROW_BY_KEY, vec![text(key.as_ref())])?.as_slice() {
        [] => Ok(None),
        [row] => Ok(Some(parse_row(row)?.row)),
        _ => Err(invariant()),
    }
}

/// Runs `select` + `IN (…)` over `keys`, a batch at a time.
fn by_keys(
    connection: &Db,
    select: &str,
    keys: &[String],
    mut visit: impl FnMut(&[Value]) -> Result<(), TursoStorageError>,
) -> Result<(), TursoStorageError> {
    for keys in keys.chunks(LOOKUP_BATCH) {
        let sql = format!(
            "{select} WHERE record_key IN ({})",
            sql_placeholders(keys.len())
        );
        for row in driver::query(connection, &sql, keys.iter().map(|key| text(key)).collect())? {
            visit(&row)?;
        }
    }
    Ok(())
}

fn held_rows(connection: &Db, keys: &[String]) -> Result<Vec<HeldRow>, TursoStorageError> {
    let mut held = Vec::new();
    by_keys(connection, ALL_ROWS, keys, |row| {
        held.push(parse_row(row)?);
        Ok(())
    })?;
    Ok(held)
}

fn window_rows(
    connection: &Db,
    sql: &str,
    request: &ChannelTimelineRequest,
    scope: &TimelineScope,
    low: &str,
    high: &str,
    limit: usize,
) -> Result<Vec<ChannelTimelineRow>, TursoStorageError> {
    driver::query(
        connection,
        sql,
        vec![
            text(&scope.storage_key()),
            text(low),
            text(high),
            Value::from_i64(i64::try_from(limit).map_err(|_| invariant())?),
        ],
    )?
    .iter()
    .map(|row| {
        if row.len() != 2 {
            return Err(invariant());
        }
        Ok(ChannelTimelineRow {
            record_key: parse_entity(required_text(row, 0)?)?,
            channel_id: request.channel_id.clone(),
            scope: scope.clone(),
            sort_key: required_text(row, 1)?,
            hidden: false,
        })
    })
    .collect()
}

fn load_coverage(
    connection: &Db,
    channel_id: &str,
    scope: &TimelineScope,
) -> Result<Vec<TimelineSpan>, TursoStorageError> {
    driver::query(
        connection,
        COVERAGE_SELECT,
        vec![text(channel_id), text(&scope.storage_key())],
    )?
    .iter()
    .map(|row| {
        if row.len() != 2 {
            return Err(invariant());
        }
        Ok(TimelineSpan {
            start: required_text(row, 0)?,
            end: required_text(row, 1)?,
        })
    })
    .collect()
}

struct SyncRow {
    seq: Option<i64>,
    touched_at_ms: i64,
}

fn load_sync(connection: &Db, channel_id: &str) -> Result<Option<SyncRow>, TursoStorageError> {
    match driver::query(connection, SYNC_SELECT, vec![text(channel_id)])?.as_slice() {
        [] => Ok(None),
        [row] if row.len() == 2 => Ok(Some(SyncRow {
            seq: match &row[0] {
                Value::Null => None,
                _ => Some(required_i64(row, 0)?),
            },
            touched_at_ms: required_i64(row, 1)?,
        })),
        _ => Err(invariant()),
    }
}

fn query_snapshot(
    connection: &Db,
    request: &ChannelTimelineRequest,
    pending: usize,
) -> Result<ChannelTimelineSnapshot, TursoStorageError> {
    let seq = load_sync(connection, &request.channel_id)?.and_then(|sync| sync.seq);
    let scope = request.scope();
    let mut anchor = match &request.around {
        Some(key) => row_by_key(connection, key)?,
        None => None,
    };
    if let Some(root_key) = anchor
        .as_ref()
        .and_then(|row| anchor_root_key(request, row))
    {
        anchor = row_by_key(connection, &root_key)?;
    }
    let spans = load_coverage(connection, &request.channel_id, &scope)?;
    let Some(plan) = plan_window(request, anchor.as_ref(), &spans, pending) else {
        return Ok(ChannelTimelineSnapshot {
            seq,
            ..ChannelTimelineSnapshot::default()
        });
    };
    let older = if plan.read_older {
        window_rows(
            connection,
            ROWS_OLDER,
            request,
            &scope,
            &plan.span.start,
            &plan.position,
            plan.read_limit,
        )?
    } else {
        Vec::new()
    };
    let newer = if plan.read_newer {
        window_rows(
            connection,
            ROWS_NEWER,
            request,
            &scope,
            &plan.position,
            &plan.span.end,
            plan.read_limit,
        )?
    } else {
        Vec::new()
    };
    Ok(ChannelTimelineSnapshot {
        span: Some(plan.span),
        anchor,
        older,
        newer,
        seq,
    })
}

fn record_keys(
    connection: &Db,
    sql: &str,
    values: &[&str],
) -> Result<Vec<String>, TursoStorageError> {
    driver::query(connection, sql, values.iter().copied().map(text).collect())?
        .iter()
        .map(|row| required_text(row, 0))
        .collect()
}

fn load_guard(
    connection: &Db,
    query: &ChannelGuardQuery,
) -> Result<ChannelGuard, TursoStorageError> {
    let mut guard = ChannelGuard::default();
    let keys = query
        .keys
        .iter()
        .map(|key| key.as_ref().to_owned())
        .collect::<Vec<_>>();
    for (select, removed) in [
        (
            "SELECT record_key, channel_id, seq FROM channel_timeline",
            false,
        ),
        (
            "SELECT record_key, channel_id, seq FROM channel_removed",
            true,
        ),
    ] {
        by_keys(connection, select, &keys, |row| {
            let state = ChannelEntryState {
                channel_id: required_text(row, 1)?,
                seq: required_i64(row, 2)?,
                removed,
            };
            let key = parse_entity(required_text(row, 0)?)?;
            match guard.entries.insert(key, state) {
                None => Ok(()),
                Some(_) => Err(invariant()),
            }
        })?;
    }
    for channel_id in &query.channels {
        if let Some(sync) = load_sync(connection, channel_id)? {
            guard.sync.insert(
                channel_id.clone(),
                ChannelSync {
                    channel_id: channel_id.clone(),
                    seq: sync.seq,
                    touched_at_ms: sync.touched_at_ms,
                },
            );
        }
    }
    for (channel_id, scope) in &query.coverage {
        let spans = load_coverage(connection, channel_id, scope)?;
        if !spans.is_empty() {
            guard
                .coverage
                .insert((channel_id.clone(), scope.clone()), spans);
        }
    }
    Ok(guard)
}

fn load_entries(
    connection: &Db,
    channel_id: &str,
    entries: ChannelEntries<'_>,
) -> Result<Vec<String>, TursoStorageError> {
    let seq_keys = |sql, seq| {
        driver::query(
            connection,
            sql,
            vec![text(channel_id), Value::from_i64(seq)],
        )?
        .iter()
        .map(|row| required_text(row, 0))
        .collect::<Result<Vec<_>, _>>()
    };
    match entries {
        ChannelEntries::All => {
            let mut keys = record_keys(connection, KEYS_BY_CHANNEL, &[channel_id])?;
            keys.extend(record_keys(connection, REMOVED_BY_CHANNEL, &[channel_id])?);
            Ok(keys)
        }
        ChannelEntries::HeldBelow(seq) => seq_keys(KEYS_BELOW, seq),
        ChannelEntries::TombstonesThrough(seq) => seq_keys(REMOVED_THROUGH, seq),
        ChannelEntries::Thread(root_id) => {
            let scope = TimelineScope::Thread(root_id.to_owned()).storage_key();
            record_keys(connection, KEYS_BY_SCOPE, &[&scope, channel_id])
        }
    }
}

/// Deletes entries with everything held of them, and returns the keys of the
/// records that existed.
fn delete_entries<'a>(
    connection: &Db,
    keys: impl IntoIterator<Item = &'a str>,
) -> Result<Vec<EntityKey<'static>>, TursoStorageError> {
    let mut deleted = Vec::new();
    let mut record_statement = driver::prepare(connection, RECORD_DELETE)?;
    let mut row_statement = driver::prepare(connection, ROW_DELETE)?;
    let mut removed_statement = driver::prepare(connection, REMOVED_DELETE)?;
    for key in keys {
        let record = record_key(key.to_owned())?;
        match driver::execute_prepared(
            &mut record_statement,
            vec![text(&record.typename), text(&record.id)],
        )? {
            0 => {}
            1 => deleted.push(record.into_entity()?),
            _ => return Err(invariant()),
        }
        for statement in [&mut row_statement, &mut removed_statement] {
            if !(0..=1).contains(&driver::execute_prepared(statement, vec![text(key)])?) {
                return Err(invariant());
            }
        }
    }
    Ok(deleted)
}

/// Applies a decided channel write in the transaction of the records it
/// belongs to, before they are written.
pub(super) fn apply(connection: &Db, write: &ChannelWrite) -> Result<(), TursoStorageError> {
    if !write.deleted.is_empty() {
        delete_entries(connection, write.deleted.iter().map(AsRef::as_ref))?;
    }
    for channel_id in &write.uncovered {
        driver::execute(connection, COVERAGE_DELETE_CHANNEL, vec![text(channel_id)])?;
    }
    for tombstone in &write.tombstones {
        delete_key(connection, ROW_DELETE, tombstone.record_key.as_ref())?;
    }
    insert_rows(
        connection,
        REMOVED_UPSERT_PREFIX,
        REMOVED_UPSERT_SUFFIX,
        3,
        write
            .tombstones
            .iter()
            .flat_map(|tombstone| {
                [
                    text(tombstone.record_key.as_ref()),
                    text(&tombstone.channel_id),
                    Value::from_i64(tombstone.seq),
                ]
            })
            .collect(),
    )?;
    for row in &write.rows {
        delete_key(connection, REMOVED_DELETE, row.row.record_key.as_ref())?;
    }
    insert_rows(
        connection,
        ROW_UPSERT_PREFIX,
        ROW_UPSERT_SUFFIX,
        6,
        write
            .rows
            .iter()
            .flat_map(|row| {
                row_values(&row.row)
                    .into_iter()
                    .chain([Value::from_i64(row.seq)])
            })
            .collect(),
    )?;
    let channels = write
        .rows
        .iter()
        .map(|row| row.row.channel_id.as_str())
        .collect::<BTreeSet<_>>();
    for channel_id in channels {
        driver::execute(connection, SYNC_ENSURE, vec![text(channel_id)])?;
    }
    for coverage in &write.coverage {
        let scope = coverage.scope.storage_key();
        driver::execute(
            connection,
            COVERAGE_DELETE_SCOPE,
            vec![text(&coverage.channel_id), text(&scope)],
        )?;
        for span in &coverage.spans {
            require_changed(
                driver::execute(
                    connection,
                    COVERAGE_INSERT,
                    vec![
                        text(&coverage.channel_id),
                        text(&scope),
                        text(&span.start),
                        text(&span.end),
                    ],
                )?,
                1,
            )?;
        }
    }
    for sync in &write.sync {
        driver::execute(
            connection,
            SYNC_UPSERT,
            vec![
                text(&sync.channel_id),
                sync.seq.map_or(Value::Null, Value::from_i64),
                Value::from_i64(sync.touched_at_ms),
            ],
        )?;
    }
    Ok(())
}

fn apply_eviction(
    connection: &Db,
    eviction: &ChannelEviction,
) -> Result<ChannelEvictionOutcome, TursoStorageError> {
    let max_channels = usize::from(eviction.max_channels);
    let mut channel_ids = driver::query(
        connection,
        SYNC_STALE,
        vec![
            Value::from_i64(eviction.touched_before_ms),
            Value::from_i64(i64::from(eviction.max_channels) + 1),
        ],
    )?
    .iter()
    .map(|row| required_text(row, 0))
    .collect::<Result<Vec<_>, _>>()?;
    let has_more = channel_ids.len() > max_channels;
    channel_ids.truncate(max_channels);
    let mut doomed = BTreeSet::new();
    for channel_id in &channel_ids {
        doomed.extend(load_entries(connection, channel_id, ChannelEntries::All)?);
        driver::execute(connection, COVERAGE_DELETE_CHANNEL, vec![text(channel_id)])?;
        driver::execute(connection, SYNC_DELETE, vec![text(channel_id)])?;
    }
    Ok(ChannelEvictionOutcome {
        deleted_keys: delete_entries(connection, doomed.iter().map(String::as_str))?,
        channel_ids,
        has_more,
    })
}

fn count(connection: &Db, sql: &str) -> Result<u64, TursoStorageError> {
    match driver::query(connection, sql, Vec::new())?.as_slice() {
        [row] => u64::try_from(required_i64(row, 0)?).map_err(|_| invariant()),
        _ => Err(invariant()),
    }
}

impl TursoStorage {
    pub(super) fn channel_guard(
        &self,
        query: &ChannelGuardQuery,
    ) -> Result<ChannelGuard, TursoStorageError> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || load_guard(&connection, query));
        self.latch_result(result)
    }

    pub(super) fn channel_entries(
        &self,
        channel_id: &str,
        entries: ChannelEntries<'_>,
    ) -> Result<Vec<EntityKey<'static>>, TursoStorageError> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            load_entries(&connection, channel_id, entries)?
                .into_iter()
                .map(parse_entity)
                .collect()
        });
        self.latch_result(result)
    }
}

impl ChannelTimelineStorage for TursoStorage {
    async fn query_channel_timeline(
        &self,
        request: &ChannelTimelineRequest,
        pending: usize,
    ) -> Result<ChannelTimelineSnapshot, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            query_snapshot(&connection, request, pending)
        });
        self.latch_result(result)
    }

    async fn channel_timeline_evict(
        &mut self,
        eviction: &ChannelEviction,
    ) -> Result<ChannelEvictionOutcome, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            eviction
                .validate()
                .map_err(|_| TursoStorageError::InvalidInput)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || apply_eviction(&connection, eviction))
        })();
        self.latch_result(result)
    }

    async fn channel_timeline_stats(&self) -> Result<ChannelTimelineStats, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            Ok(ChannelTimelineStats {
                channels: count(&connection, SYNC_COUNT)?,
                entries: count(&connection, ROW_COUNT)?,
            })
        });
        self.latch_result(result)
    }
}

/// Validates the frozen channel tables, their columns, and every index.
pub(super) fn validate_schema(connection: &Db) -> Result<(), TursoStorageError> {
    let column = |name, declared_type, not_null, primary_key_position| ColumnSpec {
        name,
        declared_type,
        not_null,
        default_zero: false,
        primary_key_position,
    };
    validate_table_columns(
        connection,
        "channel_timeline",
        &[
            column("record_key", "TEXT", false, 1),
            column("channel_id", "TEXT", true, 0),
            column("scope", "TEXT", true, 0),
            column("sort_key", "TEXT", true, 0),
            column("hidden", "INTEGER", true, 0),
            column("seq", "INTEGER", true, 0),
        ],
    )?;
    validate_table_columns(
        connection,
        "channel_removed",
        &[
            column("record_key", "TEXT", false, 1),
            column("channel_id", "TEXT", true, 0),
            column("seq", "INTEGER", true, 0),
        ],
    )?;
    validate_table_columns(
        connection,
        "channel_coverage",
        &[
            column("channel_id", "TEXT", true, 1),
            column("scope", "TEXT", true, 2),
            column("start", "TEXT", true, 3),
            column("end", "TEXT", true, 0),
        ],
    )?;
    validate_table_columns(
        connection,
        "channel_sync",
        &[
            column("channel_id", "TEXT", false, 1),
            column("seq", "INTEGER", false, 0),
            column("touched_at_ms", "INTEGER", true, 0),
        ],
    )?;
    validate_table_indexes(
        connection,
        "channel_coverage",
        &[(0, "channel_id"), (1, "scope"), (2, "start")],
    )?;
    validate_table_indexes(connection, "channel_sync", &[(0, "channel_id")])?;
    validate_named_indexes(
        connection,
        "channel_timeline",
        &[
            (
                "channel_timeline_scan_idx",
                &["scope", "hidden", "sort_key", "record_key"][..],
            ),
            (
                "channel_timeline_channel_idx",
                &["channel_id", "record_key"][..],
            ),
        ],
    )?;
    validate_named_indexes(
        connection,
        "channel_removed",
        &[(
            "channel_removed_channel_idx",
            &["channel_id", "seq", "record_key"][..],
        )],
    )?;
    for table in TABLES {
        validate_table_constraints(connection, table, false)?;
        validate_no_foreign_keys(connection, table)?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
