//! Channel timeline index, fetched-stretch coverage, and per-channel sync state.

use super::*;
use cache_core::channel_timeline::{
    ACTIVITY_TYPENAME, CHANNEL_TIMELINE_PROJECTION_VERSION, ChannelCommitOutcome, ChannelEviction,
    ChannelEvictionOutcome, ChannelTimelineCommit, ChannelTimelineRequest, ChannelTimelineRow,
    ChannelTimelineSnapshot, ChannelTimelineStats, ChannelTimelineStorage, MESSAGE_TYPENAME,
    TimelineScope, TimelineSpan, anchor_root_key, commit_coverage_by_scope, merge_spans, next_seq,
    plan_window, project_channel_timeline,
};

pub(super) const CREATE_SCHEMA: [&str; 5] = [
    "CREATE TABLE channel_timeline (record_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL, scope TEXT NOT NULL, sort_key TEXT NOT NULL, hidden INTEGER NOT NULL)",
    "CREATE INDEX channel_timeline_scan_idx ON channel_timeline(scope, hidden, sort_key, record_key)",
    "CREATE INDEX channel_timeline_channel_idx ON channel_timeline(channel_id, record_key)",
    "CREATE TABLE channel_coverage (channel_id TEXT NOT NULL, scope TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, PRIMARY KEY (channel_id, scope, start))",
    "CREATE TABLE channel_sync (channel_id TEXT PRIMARY KEY, seq INTEGER, touched_at_ms INTEGER NOT NULL)",
];

pub(super) const TABLES: [&str; 3] = ["channel_coverage", "channel_sync", "channel_timeline"];
pub(super) const NAMED_INDEXES: [&str; 2] =
    ["channel_timeline_channel_idx", "channel_timeline_scan_idx"];

const ROW_UPSERT: &str = "INSERT INTO channel_timeline (record_key, channel_id, scope, sort_key, hidden) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (record_key) DO UPDATE SET channel_id = excluded.channel_id, scope = excluded.scope, sort_key = excluded.sort_key, hidden = excluded.hidden";
const ROW_DELETE: &str = "DELETE FROM channel_timeline WHERE record_key = ?1";
const ROW_BY_KEY: &str = "SELECT record_key, channel_id, scope, sort_key, hidden FROM channel_timeline WHERE record_key = ?1";
// Both page reads stay on the (scope, hidden, sort_key) prefix and stop at
// the limit, so a page costs the same in a 50-message and a 50,000-message
// channel.
const ROWS_OLDER: &str = "SELECT record_key, sort_key FROM channel_timeline INDEXED BY channel_timeline_scan_idx WHERE scope = ?1 AND hidden = 0 AND sort_key >= ?2 AND sort_key < ?3 ORDER BY sort_key DESC LIMIT ?4";
const ROWS_NEWER: &str = "SELECT record_key, sort_key FROM channel_timeline INDEXED BY channel_timeline_scan_idx WHERE scope = ?1 AND hidden = 0 AND sort_key > ?2 AND sort_key <= ?3 ORDER BY sort_key ASC LIMIT ?4";
const KEYS_BY_SCOPE: &str =
    "SELECT record_key FROM channel_timeline INDEXED BY channel_timeline_scan_idx WHERE scope = ?1";
const KEYS_BY_CHANNEL: &str = "SELECT record_key FROM channel_timeline INDEXED BY channel_timeline_channel_idx WHERE channel_id = ?1";
const COVERAGE_SELECT: &str =
    "SELECT start, end FROM channel_coverage WHERE channel_id = ?1 AND scope = ?2";
const COVERAGE_INSERT: &str =
    "INSERT INTO channel_coverage (channel_id, scope, start, end) VALUES (?1, ?2, ?3, ?4)";
const COVERAGE_DELETE_SCOPE: &str =
    "DELETE FROM channel_coverage WHERE channel_id = ?1 AND scope = ?2";
const COVERAGE_DELETE_CHANNEL: &str = "DELETE FROM channel_coverage WHERE channel_id = ?1";
const SYNC_SELECT: &str = "SELECT seq, touched_at_ms FROM channel_sync WHERE channel_id = ?1";
const SYNC_UPSERT: &str = "INSERT INTO channel_sync (channel_id, seq, touched_at_ms) VALUES (?1, ?2, ?3) ON CONFLICT (channel_id) DO UPDATE SET seq = excluded.seq, touched_at_ms = excluded.touched_at_ms";
const SYNC_DELETE: &str = "DELETE FROM channel_sync WHERE channel_id = ?1";
// One row per channel the device holds: small enough to scan.
const SYNC_STALE: &str = "SELECT channel_id FROM channel_sync WHERE touched_at_ms < ?1 ORDER BY touched_at_ms ASC, channel_id ASC LIMIT ?2";
const SYNC_COUNT: &str = "SELECT COUNT(*) FROM channel_sync";
const ROW_COUNT: &str = "SELECT COUNT(*) FROM channel_timeline";
const META_SELECT: &str = "SELECT value FROM meta WHERE key = ?1";
const META_UPSERT: &str = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
const PROJECTION_VERSION_KEY: &str = "channel_timeline_projection_version";

pub(super) const VALIDATED_SQL: [&str; 19] = [
    ROW_UPSERT,
    ROW_DELETE,
    ROW_BY_KEY,
    ROWS_OLDER,
    ROWS_NEWER,
    KEYS_BY_SCOPE,
    KEYS_BY_CHANNEL,
    COVERAGE_SELECT,
    COVERAGE_INSERT,
    COVERAGE_DELETE_SCOPE,
    COVERAGE_DELETE_CHANNEL,
    SYNC_SELECT,
    SYNC_UPSERT,
    SYNC_DELETE,
    SYNC_STALE,
    SYNC_COUNT,
    ROW_COUNT,
    META_SELECT,
    META_UPSERT,
];

fn is_entry(typename: &str) -> bool {
    typename == MESSAGE_TYPENAME || typename == ACTIVITY_TYPENAME
}

/// Writes or removes the timeline row of every message and activity entry,
/// keeping the last entry for a key exactly like the record upsert does.
pub(super) fn write_rows(
    connection: &Arc<Connection>,
    entries: &[EncodedRecord],
) -> Result<(), TursoStorageError> {
    let mut last = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        if is_entry(&entry.key.typename) {
            last.insert((entry.key.typename.as_str(), entry.key.id.as_str()), index);
        }
    }
    if last.is_empty() {
        return Ok(());
    }
    let mut upsert = driver::prepare(connection, ROW_UPSERT)?;
    let mut delete = driver::prepare(connection, ROW_DELETE)?;
    let mut indexes = last.into_values().collect::<Vec<_>>();
    indexes.sort_unstable();
    for index in indexes {
        let entry = &entries[index];
        match &entry.channel_timeline {
            Some(row) => {
                require_changed(driver::execute_prepared(&mut upsert, row_values(row))?, 1)?;
            }
            None => delete_row(&mut delete, &entity_key_text(&entry.key))?,
        }
    }
    Ok(())
}

/// Removes the timeline rows of deleted message and activity records.
pub(super) fn delete_rows(
    connection: &Arc<Connection>,
    keys: &[RecordKey],
) -> Result<(), TursoStorageError> {
    let mut statement = None;
    for key in keys.iter().filter(|key| is_entry(&key.typename)) {
        let statement = match statement.as_mut() {
            Some(statement) => statement,
            None => statement.insert(driver::prepare(connection, ROW_DELETE)?),
        };
        delete_row(statement, &entity_key_text(key))?;
    }
    Ok(())
}

/// Removes every timeline row, stretch and sync row with the rest of the cache.
pub(super) fn clear(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    for table in TABLES {
        driver::execute(connection, &format!("DELETE FROM {table}"), Vec::new())?;
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
            text(&CHANNEL_TIMELINE_PROJECTION_VERSION.to_string()),
        ],
    )?;
    Ok(())
}

/// Rebuilds the disposable timeline rows from message and activity records
/// when the projection changed, without touching records, coverage, or sync
/// state.
pub(super) fn ensure_projection_version(
    connection: &Arc<Connection>,
) -> Result<(), TursoStorageError> {
    let versions = driver::query(connection, META_SELECT, vec![text(PROJECTION_VERSION_KEY)])?;
    if let [row] = versions.as_slice()
        && required_text(row, 0)? == CHANNEL_TIMELINE_PROJECTION_VERSION.to_string()
    {
        return Ok(());
    }
    driver::write_transaction(connection, || {
        driver::execute(connection, "DELETE FROM channel_timeline", Vec::new())?;
        let mut upsert = driver::prepare(connection, ROW_UPSERT)?;
        for typename in [MESSAGE_TYPENAME, ACTIVITY_TYPENAME] {
            for_each_record(connection, typename, |key, record| {
                if let Some(row) = project_channel_timeline(key, record) {
                    require_changed(driver::execute_prepared(&mut upsert, row_values(&row))?, 1)?;
                }
                Ok(())
            })?;
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

fn parse_entity(value: String) -> Result<EntityKey<'static>, TursoStorageError> {
    RecordKey::from_entity(&EntityKey(value.as_str().into()))
        .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Corruption))?
        .into_entity()
}

fn parse_scope(value: &str) -> Result<TimelineScope, TursoStorageError> {
    match value.split_at_checked(2) {
        Some(("c:", channel_id)) => Ok(TimelineScope::Channel(channel_id.to_owned())),
        Some(("t:", root_id)) => Ok(TimelineScope::Thread(root_id.to_owned())),
        _ => Err(invariant()),
    }
}

fn row_by_key(
    connection: &Arc<Connection>,
    key: &EntityKey<'_>,
) -> Result<Option<ChannelTimelineRow>, TursoStorageError> {
    match driver::query(connection, ROW_BY_KEY, vec![text(key.as_ref())])?.as_slice() {
        [] => Ok(None),
        [row] if row.len() == 5 => Ok(Some(ChannelTimelineRow {
            record_key: parse_entity(required_text(row, 0)?)?,
            channel_id: required_text(row, 1)?,
            scope: parse_scope(&required_text(row, 2)?)?,
            sort_key: required_text(row, 3)?,
            hidden: required_i64(row, 4)? != 0,
        })),
        _ => Err(invariant()),
    }
}

fn window_rows(
    connection: &Arc<Connection>,
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
    connection: &Arc<Connection>,
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

fn load_sync(
    connection: &Arc<Connection>,
    channel_id: &str,
) -> Result<Option<SyncRow>, TursoStorageError> {
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
    connection: &Arc<Connection>,
    request: &ChannelTimelineRequest,
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
    let Some(plan) = plan_window(request, anchor.as_ref(), &spans) else {
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
    connection: &Arc<Connection>,
    sql: &str,
    value: &str,
) -> Result<Vec<String>, TursoStorageError> {
    driver::query(connection, sql, vec![text(value)])?
        .iter()
        .map(|row| required_text(row, 0))
        .collect()
}

/// Deletes the named records with their timeline rows and returns the keys
/// that existed.
fn delete_records(
    connection: &Arc<Connection>,
    doomed: BTreeSet<String>,
) -> Result<Vec<EntityKey<'static>>, TursoStorageError> {
    let doomed = doomed
        .into_iter()
        .map(|key| RecordKey::from_entity(&EntityKey(key.into())))
        .collect::<Result<Vec<_>, _>>()?;
    let mut deleted_keys = Vec::new();
    {
        let mut record_statement = driver::prepare(connection, RECORD_DELETE)?;
        for key in &doomed {
            match driver::execute_prepared(
                &mut record_statement,
                vec![text(&key.typename), text(&key.id)],
            )? {
                0 => {}
                1 => deleted_keys.push(parse_entity(entity_key_text(key))?),
                _ => return Err(invariant()),
            }
        }
    }
    delete_rows(connection, &doomed)?;
    Ok(deleted_keys)
}

fn apply_commit(
    connection: &Arc<Connection>,
    commit: &ChannelTimelineCommit,
) -> Result<ChannelCommitOutcome, TursoStorageError> {
    let channel_id = commit.channel_id.as_str();
    let mut doomed = BTreeSet::new();
    if commit.reset {
        doomed.extend(record_keys(connection, KEYS_BY_CHANNEL, channel_id)?);
        driver::execute(connection, COVERAGE_DELETE_CHANNEL, vec![text(channel_id)])?;
    }
    doomed.extend(
        commit
            .removed_keys
            .iter()
            .map(|key| key.as_ref().to_owned()),
    );
    for root_id in &commit.dropped_thread_root_ids {
        let scope = TimelineScope::Thread(root_id.clone()).storage_key();
        doomed.extend(record_keys(connection, KEYS_BY_SCOPE, &scope)?);
        driver::execute(
            connection,
            COVERAGE_DELETE_SCOPE,
            vec![text(channel_id), text(&scope)],
        )?;
    }
    let deleted_keys = delete_records(connection, doomed)?;

    for (scope, spans) in commit_coverage_by_scope(commit) {
        let held = load_coverage(connection, channel_id, &scope)?;
        let scope = scope.storage_key();
        driver::execute(
            connection,
            COVERAGE_DELETE_SCOPE,
            vec![text(channel_id), text(&scope)],
        )?;
        let mut insert = driver::prepare(connection, COVERAGE_INSERT)?;
        for span in merge_spans(held.into_iter().chain(spans)) {
            require_changed(
                driver::execute_prepared(
                    &mut insert,
                    vec![
                        text(channel_id),
                        text(&scope),
                        text(&span.start),
                        text(&span.end),
                    ],
                )?,
                1,
            )?;
        }
    }

    let stored = load_sync(connection, channel_id)?;
    let stored_seq = stored.as_ref().and_then(|sync| sync.seq);
    let stored_touch = stored.as_ref().map_or(0, |sync| sync.touched_at_ms);
    let seq = next_seq(stored_seq, commit);
    let touched_at_ms = commit
        .touched_at_ms
        .map_or(stored_touch, |touched| touched.max(stored_touch));
    if stored.is_none() || seq != stored_seq || touched_at_ms != stored_touch {
        driver::execute(
            connection,
            SYNC_UPSERT,
            vec![
                text(channel_id),
                seq.map_or(Value::Null, Value::from_i64),
                Value::from_i64(touched_at_ms),
            ],
        )?;
    }
    Ok(ChannelCommitOutcome { deleted_keys, seq })
}

fn apply_eviction(
    connection: &Arc<Connection>,
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
        doomed.extend(record_keys(connection, KEYS_BY_CHANNEL, channel_id)?);
        driver::execute(connection, COVERAGE_DELETE_CHANNEL, vec![text(channel_id)])?;
        driver::execute(connection, SYNC_DELETE, vec![text(channel_id)])?;
    }
    Ok(ChannelEvictionOutcome {
        deleted_keys: delete_records(connection, doomed)?,
        channel_ids,
        has_more,
    })
}

fn count(connection: &Arc<Connection>, sql: &str) -> Result<u64, TursoStorageError> {
    match driver::query(connection, sql, Vec::new())?.as_slice() {
        [row] => u64::try_from(required_i64(row, 0)?).map_err(|_| invariant()),
        _ => Err(invariant()),
    }
}

impl ChannelTimelineStorage for TursoStorage {
    async fn query_channel_timeline(
        &self,
        request: &ChannelTimelineRequest,
    ) -> Result<ChannelTimelineSnapshot, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || query_snapshot(&connection, request));
        self.latch_result(result)
    }

    async fn channel_timeline_commit(
        &mut self,
        commit: &ChannelTimelineCommit,
    ) -> Result<ChannelCommitOutcome, Self::Error> {
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
        "channel_timeline",
        &[
            column("record_key", "TEXT", false, 1),
            column("channel_id", "TEXT", true, 0),
            column("scope", "TEXT", true, 0),
            column("sort_key", "TEXT", true, 0),
            column("hidden", "INTEGER", true, 0),
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
    for table in TABLES {
        validate_table_constraints(connection, table, false)?;
        validate_no_foreign_keys(connection, table)?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
