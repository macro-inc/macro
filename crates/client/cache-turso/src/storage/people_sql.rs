//! Disposable contact facts in the existing predicate index. A query never
//! decodes a normalized contact: only its bounded final SQL result leaves Turso.
use super::*;
use cache_core::people::sql::{
    PeopleSqlPlan, PeopleSqlResult, SqlParameter, SqlScalar, projection,
};
use cache_core::value::CacheValue;

const VERSION_KEY: &str = "people_sql_projection_version";
fn statement(plan: &PeopleSqlPlan) -> String {
    let mut sql = "WITH __people AS (SELECT d.id AS __document, NULL AS row_position".to_owned();
    let mut joins = String::new();
    // Attribute names come only from the shared compiler's private plan, never
    // from the caller. Exact predicates stay BLOB comparisons for index seeks.
    for (index, attribute) in plan.attributes().enumerate() {
        if matches!(attribute, "name_lower" | "email_lower") {
            sql.push_str(&format!(", CAST(f{index}.value AS TEXT) AS {attribute}"));
        } else {
            sql.push_str(&format!(", f{index}.value AS {attribute}"));
        }
        joins.push_str(&format!(" JOIN exact_facts AS f{index} ON f{index}.document_id = d.id AND f{index}.attribute = '{attribute}'"));
    }
    sql.push_str(" FROM index_documents AS d");
    sql.push_str(&joins);
    sql.push_str(" WHERE d.profile = ? AND d.partition = ? AND d.state = 0)");
    sql.push_str(plan.sql());
    sql
}

fn viewer(connection: &Arc<Connection>) -> Result<Option<String>, TursoStorageError> {
    let key = RecordKey::from_entity(&EntityKey(cache_core::engine::IDENTITY_META_KEY.into()))?;
    let rows = driver::query(
        connection,
        "SELECT value FROM records WHERE __typename = ? AND id = ?",
        vec![text(&key.typename), text(&key.id)],
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let record = decode_record(&required_blob(row, 0)?).map_err(|_| invariant())?;
    match record.fields.get(cache_core::engine::IDENTITY_VALUE_FIELD) {
        Some(CacheValue::String(identity)) => Ok(Some(identity.clone())),
        _ => Ok(None),
    }
}

fn stamp(viewer: Option<&str>) -> String {
    format!(
        "1:{}",
        viewer
            .map(projection::partition)
            .unwrap_or_else(|| "unbound".into())
    )
}

fn project(
    connection: &Arc<Connection>,
    viewer: &str,
    key: &RecordKey,
    record: &Record,
) -> Result<(), TursoStorageError> {
    let key = key.clone().into_entity()?;
    let projection = projection::project(viewer, &key, record).map_err(|_| invariant())?;
    write_projection_state(
        connection,
        &PredicateRecordKey::new(key.as_ref()).map_err(|_| invariant())?,
        projection.as_ref(),
    )
}

/// Called inside the caller's transaction. Rebuild only on a profile/account
/// transition, in bounded record batches, without changing normalized authority.
fn ensure(connection: &Arc<Connection>, viewer: Option<&str>) -> Result<bool, TursoStorageError> {
    let stamp = stamp(viewer);
    let versions = driver::query(
        connection,
        "SELECT value FROM meta WHERE key = ?",
        vec![text(VERSION_KEY)],
    )?;
    if let [row] = versions.as_slice()
        && required_text(row, 0)? == stamp
    {
        return Ok(false);
    }
    driver::execute(
        connection,
        "DELETE FROM index_documents WHERE profile = ?",
        vec![text(projection::PROFILE)],
    )?;
    if let Some(viewer) = viewer {
        let mut after = String::new();
        loop {
            let rows = driver::query(
                connection,
                SEARCH_REBUILD_RECORDS_AFTER,
                vec![
                    text("GraphqlContact"),
                    text(&after),
                    Value::from_i64(SEARCH_REBUILD_BATCH_SIZE),
                ],
            )?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let key = RecordKey {
                    typename: "GraphqlContact".into(),
                    id: required_text(&row, 0)?,
                };
                let record = decode_record(&required_blob(&row, 1)?).map_err(|_| invariant())?;
                project(connection, viewer, &key, &record)?;
                after = key.id;
            }
        }
    }
    driver::execute(
        connection,
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        vec![text(VERSION_KEY), text(&stamp)],
    )?;
    Ok(true)
}

pub(super) fn open(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    driver::write_transaction(connection, || {
        ensure(connection, viewer(connection)?.as_deref())?;
        Ok(())
    })
}

pub(super) fn write(
    connection: &Arc<Connection>,
    entries: &[EncodedRecord],
) -> Result<(), TursoStorageError> {
    if !entries.iter().any(|entry| {
        entry.contact.is_some() || entry.key.typename == "__meta" && entry.key.id == "identity"
    }) {
        return Ok(());
    }
    let viewer = viewer(connection)?;
    if ensure(connection, viewer.as_deref())? {
        return Ok(());
    }
    if let Some(viewer) = viewer {
        for entry in entries {
            if let Some(record) = &entry.contact {
                project(connection, &viewer, &entry.key, record)?;
            }
        }
    }
    Ok(())
}

pub(super) fn delete(
    connection: &Arc<Connection>,
    keys: &[RecordKey],
) -> Result<(), TursoStorageError> {
    for key in keys.iter().filter(|key| key.typename == "GraphqlContact") {
        let key = PredicateRecordKey::new(key.clone().into_entity()?.as_ref())
            .map_err(|_| invariant())?;
        write_projection_state(connection, &key, None)?;
    }
    Ok(())
}

pub(super) fn read(
    connection: &Arc<Connection>,
    identity: &str,
    plan: &PeopleSqlPlan,
) -> Result<PeopleSqlResult, TursoStorageError> {
    driver::read_transaction(connection, || {
        if viewer(connection)?.as_deref() != Some(identity) {
            return Err(TursoStorageError::InvalidInput);
        }
        let partition = projection::partition(identity);
        let versions = driver::query(
            connection,
            "SELECT value FROM meta WHERE key = ?",
            vec![text(VERSION_KEY)],
        )?;
        if !matches!(versions.as_slice(), [row] if required_text(row, 0)? == stamp(Some(identity)))
        {
            return Ok(PeopleSqlResult::Incomplete);
        }
        let incomplete = driver::query(
            connection,
            "SELECT 1 FROM index_documents WHERE profile = ? AND partition = ? AND state > 0 LIMIT 1",
            vec![text(projection::PROFILE), text(&partition)],
        )?;
        if !incomplete.is_empty() {
            return Ok(PeopleSqlResult::Incomplete);
        }
        let mut parameters = vec![text(projection::PROFILE), text(&partition)];
        parameters.extend(plan.parameters().iter().map(|value| match value {
            SqlParameter::Text(value) => text(value),
            SqlParameter::Bytes(value) => Value::from_blob(value.clone()),
            SqlParameter::Integer(value) => Value::from_i64(*value),
        }));
        let mut rows = Vec::new();
        let mut bytes = 0usize;
        let mut oversized = false;
        driver::query_each(connection, &statement(plan), parameters, |row| {
            if oversized {
                return Ok(());
            }
            if rows.len() > plan.limit() {
                return Err(invariant());
            }
            if rows.len() == plan.limit() {
                // Presence alone is the lookahead; do not retain its columns.
                rows.push(Vec::new());
                return Ok(());
            }
            for value in row.get_values() {
                bytes = bytes.saturating_add(match value {
                    Value::Text(value) => value.as_str().len(),
                    Value::Blob(value) => value.len(),
                    _ => 8,
                });
            }
            if bytes > cache_core::people::sql::MAX_PEOPLE_SQL_BYTES {
                oversized = true;
                rows.clear();
                return Ok(());
            }
            rows.push(
                row.get_values()
                    .map(|value| match value {
                        Value::Null => Ok(SqlScalar::Null),
                        Value::Text(value) => Ok(SqlScalar::Text(value.as_str().to_owned())),
                        Value::Blob(value) => Ok(SqlScalar::Text(
                            std::str::from_utf8(value)
                                .map_err(|_| invariant())?
                                .to_owned(),
                        )),
                        Value::Numeric(Numeric::Integer(value)) => Ok(SqlScalar::Integer(*value)),
                        _ => Err(invariant()),
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            );
            Ok(())
        })?;
        if oversized {
            return Ok(PeopleSqlResult::ResultTooLarge);
        }
        let outcome = plan.outcome(rows).map_err(|_| invariant())?;
        Ok(PeopleSqlResult::Result { outcome })
    })
}
