//! Streamed-sync lane state and lane membership, wiped with the records.

use super::*;
use cache_core::store::SyncStorage;
use cache_core::sync::SyncLaneRow;

pub(super) const CREATE_SCHEMA: [&str; 2] = [
    "CREATE TABLE sync_lanes (id TEXT PRIMARY KEY, state TEXT NOT NULL)",
    "CREATE TABLE sync_members (lane TEXT NOT NULL, record_key TEXT NOT NULL, PRIMARY KEY (lane, record_key))",
];

pub(super) const TABLES: [&str; 2] = ["sync_lanes", "sync_members"];

const LANES_SELECT: &str = "SELECT id, state FROM sync_lanes ORDER BY id";
const LANE_UPSERT: &str = "INSERT INTO sync_lanes (id, state) VALUES (?1, ?2) ON CONFLICT (id) DO UPDATE SET state = excluded.state";
const MEMBER_UPSERT: &str = "INSERT INTO sync_members (lane, record_key) VALUES (?1, ?2) ON CONFLICT (lane, record_key) DO UPDATE SET lane = excluded.lane";
const MEMBERS_SELECT: &str = "SELECT record_key FROM sync_members WHERE lane = ?1";
const MEMBER_DELETE: &str = "DELETE FROM sync_members WHERE lane = ?1 AND record_key = ?2";

pub(super) const VALIDATED_SQL: [&str; 5] = [
    LANES_SELECT,
    LANE_UPSERT,
    MEMBER_UPSERT,
    MEMBERS_SELECT,
    MEMBER_DELETE,
];

/// Upserts a lane row and adds `members` to it, inside the caller's transaction.
fn write_lane(
    connection: &Arc<Connection>,
    row: &SyncLaneRow,
    members: &[EntityKey<'static>],
) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        LANE_UPSERT,
        vec![text(&row.id), text(&row.state)],
    )?;
    if !members.is_empty() {
        let mut statement = driver::prepare(connection, MEMBER_UPSERT)?;
        for key in members {
            driver::execute_prepared(&mut statement, vec![text(&row.id), text(key.as_ref())])?;
        }
    }
    Ok(())
}

/// Removes every lane row and member with the rest of the cache.
pub(super) fn clear(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    driver::execute(connection, "DELETE FROM sync_members", Vec::new())?;
    driver::execute(connection, "DELETE FROM sync_lanes", Vec::new())?;
    Ok(())
}

/// Validates the frozen sync tables, their columns, and their key indexes.
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
        "sync_lanes",
        &[
            column("id", "TEXT", false, 1),
            column("state", "TEXT", true, 0),
        ],
    )?;
    validate_table_columns(
        connection,
        "sync_members",
        &[
            column("lane", "TEXT", true, 1),
            column("record_key", "TEXT", true, 2),
        ],
    )?;
    validate_table_indexes(connection, "sync_lanes", &[(0, "id")])?;
    validate_table_indexes(
        connection,
        "sync_members",
        &[(0, "lane"), (1, "record_key")],
    )?;
    for table in TABLES {
        validate_table_constraints(connection, table, false)?;
        validate_no_foreign_keys(connection, table)?;
    }
    Ok(())
}

impl SyncStorage for TursoStorage {
    async fn load_sync_lanes(&self) -> Result<Vec<SyncLaneRow>, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            driver::query(&connection, LANES_SELECT, Vec::new())?
                .iter()
                .map(|row| {
                    Ok(SyncLaneRow {
                        id: required_text(row, 0)?,
                        state: required_text(row, 1)?,
                    })
                })
                .collect()
        });
        self.latch_result(result)
    }

    async fn save_sync_lane(
        &mut self,
        row: SyncLaneRow,
        members: Vec<EntityKey<'static>>,
    ) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result =
            driver::write_transaction(&connection, || write_lane(&connection, &row, &members));
        self.latch_result(result)
    }

    async fn write_sync_page(
        &mut self,
        records: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
        lane: SyncLaneRow,
        members: Vec<EntityKey<'static>>,
    ) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let entries = prepare_records(records)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                let mut statement = driver::prepare(&connection, RECORD_UPSERT)?;
                for (index, entry) in entries.iter().enumerate() {
                    require_changed(
                        driver::execute_prepared(
                            &mut statement,
                            vec![
                                text(&entry.key.typename),
                                text(&entry.key.id),
                                Value::from_blob(entry.value.clone()),
                            ],
                        )?,
                        1,
                    )?;
                    self.fault_after(TestFaultSite::Put, index)?;
                }
                write_derived_rows(&connection, &entries)?;
                write_projection_mutations(&connection, projections)?;
                write_lane(&connection, &lane, &members)
            })
        })();
        self.latch_result(result)
    }

    async fn load_sync_members(
        &self,
        lanes: &[String],
    ) -> Result<Vec<EntityKey<'static>>, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            let mut keys = BTreeSet::new();
            for lane in lanes {
                for row in driver::query(&connection, MEMBERS_SELECT, vec![text(lane)])? {
                    keys.insert(EntityKey(required_text(&row, 0)?.into()));
                }
            }
            Ok(keys.into_iter().collect())
        });
        self.latch_result(result)
    }

    async fn remove_sync_members(
        &mut self,
        lanes: &[String],
        keys: &[EntityKey<'static>],
    ) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::write_transaction(&connection, || {
            let mut statement = driver::prepare(&connection, MEMBER_DELETE)?;
            for lane in lanes {
                for key in keys {
                    driver::execute_prepared(&mut statement, vec![text(lane), text(key.as_ref())])?;
                }
            }
            Ok(())
        });
        self.latch_result(result)
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
