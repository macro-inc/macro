//! Covering contact-record reads within the existing normalized cache schema.
use super::{compatibility, driver, required_i64, required_text, validate_primary_index};
use crate::TursoStorageError;
use std::sync::Arc;
use turso_core::{Connection, Value};

pub(super) const INDEX: &str = "records_contacts_cover_idx";
pub(super) const CREATE_INDEX: &str = "CREATE INDEX records_contacts_cover_idx ON records (__typename, id, value) WHERE __typename = 'GraphqlContact'";
pub(super) const LOAD: &str = include_str!("contact_search.sql");

pub(super) fn validate_indexes(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let indexes = driver::query(connection, "PRAGMA index_list('records')", vec![])
        .map_err(TursoStorageError::initialization)?;
    if indexes.len() != 2 {
        return Err(compatibility());
    }
    let primary = indexes
        .iter()
        .find(|row| required_text(row, 3).ok().as_deref() == Some("pk"))
        .ok_or_else(compatibility)?;
    validate_primary_index(connection, primary, &[(0, "__typename"), (1, "id")])?;
    let cover = indexes
        .iter()
        .find(|row| required_text(row, 1).ok().as_deref() == Some(INDEX))
        .ok_or_else(compatibility)?;
    if cover.len() != 5
        || required_i64(cover, 2).ok() != Some(0)
        || required_text(cover, 3).ok().as_deref() != Some("c")
        || required_i64(cover, 4).ok() != Some(1)
    {
        return Err(compatibility());
    }
    // The pinned engine stores canonical DDL. Exact comparison also protects
    // the case-sensitive typename literal; lowercasing it would hide omissions.
    let definition = driver::query(
        connection,
        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?1",
        vec![super::text(INDEX)],
    )
    .map_err(TursoStorageError::initialization)?;
    let [row] = definition.as_slice() else {
        return Err(compatibility());
    };
    if row.len() != 1 || required_text(row, 0).ok().as_deref() != Some(CREATE_INDEX) {
        return Err(compatibility());
    }
    let columns = driver::query(
        connection,
        "PRAGMA index_xinfo('records_contacts_cover_idx')",
        vec![],
    )
    .map_err(TursoStorageError::initialization)?;
    if columns.len() != 4 {
        return Err(compatibility());
    }
    for (position, name) in ["__typename", "id", "value"].into_iter().enumerate() {
        let row = &columns[position];
        if row.len() != 6
            || required_i64(row, 0).ok() != i64::try_from(position).ok()
            || required_i64(row, 1).ok() != i64::try_from(position).ok()
            || required_text(row, 2).ok().as_deref() != Some(name)
            || required_i64(row, 3).ok() != Some(0)
            || required_text(row, 4).ok().as_deref() != Some("BINARY")
            || required_i64(row, 5).ok() != Some(1)
        {
            return Err(compatibility());
        }
    }
    let rowid = &columns[3];
    if rowid.len() != 6
        || required_i64(rowid, 0).ok() != Some(3)
        || required_i64(rowid, 1).ok() != Some(-1)
        || !rowid.get(2).is_some_and(|value| {
            matches!(value, Value::Null)
                || matches!(value, Value::Text(text) if text.as_str().is_empty())
        })
        || required_i64(rowid, 3).ok() != Some(0)
        || required_text(rowid, 4).ok().as_deref() != Some("BINARY")
        || required_i64(rowid, 5).ok() != Some(0)
    {
        return Err(compatibility());
    }
    Ok(())
}
