//! Pending-mutation retry budgets in the existing metadata table. Keeping the
//! frozen storage schema and database identity unchanged preserves queued writes
//! across upgrades. All writes here run inside the queue's fenced transaction.

use super::{Connection, TursoStorageError, driver, invariant, nullable_text, text};
use std::sync::Arc;

const KEY_PREFIX: &str = "mutation-server-failures:";

pub(super) fn parse(value: Option<String>) -> Result<u32, TursoStorageError> {
    value
        .map(|value| value.parse().map_err(|_| invariant()))
        .transpose()
        .map(Option::unwrap_or_default)
}

pub(super) fn save(
    connection: &Arc<Connection>,
    id: i64,
    count: u32,
) -> Result<(), TursoStorageError> {
    if count == 0 {
        return Ok(());
    }
    driver::execute(
        connection,
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        vec![text(&format!("{KEY_PREFIX}{id}")), text(&count.to_string())],
    )?;
    Ok(())
}

pub(super) fn increment(connection: &Arc<Connection>, id: i64) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT value FROM meta WHERE key = ?1",
        vec![text(&format!("{KEY_PREFIX}{id}"))],
    )?;
    let count = match rows.as_slice() {
        [] => 0,
        [row] => parse(nullable_text(row, 0)?)?,
        _ => return Err(invariant()),
    };
    save(connection, id, count.saturating_add(1))
}

pub(super) fn remove(connection: &Arc<Connection>, id: i64) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        "DELETE FROM meta WHERE key = ?1",
        vec![text(&format!("{KEY_PREFIX}{id}"))],
    )?;
    Ok(())
}

pub(super) fn clear(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        "DELETE FROM meta WHERE key GLOB ?1",
        vec![text(&format!("{KEY_PREFIX}*"))],
    )?;
    Ok(())
}
