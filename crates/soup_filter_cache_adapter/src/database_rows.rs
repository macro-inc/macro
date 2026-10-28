//! Database rows in the Soup snapshot and patch paths: a row's table is its
//! one direct fact, and its cells are ordinary property facts.

use super::*;
use soup_filter_projection::database_row::{DatabaseRowProjectionInput, project_database_row};

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

type Object = serde_json::Map<String, serde_json::Value>;

fn uuid(value: Option<&serde_json::Value>) -> Result<uuid::Uuid, ()> {
    uuid::Uuid::parse_str(value.and_then(serde_json::Value::as_str).ok_or(())?).map_err(|_| ())
}

pub(super) fn complete(record_key: RecordKey, object: &Object) -> Result<IndexDocument, ()> {
    if object.get("cacheProjection") != Some(&serde_json::Value::Null) {
        return Err(());
    }
    let document = project_database_row(DatabaseRowProjectionInput {
        record_key,
        id: uuid(object.get("id"))?,
        owner: object
            .get("ownerId")
            .and_then(serde_json::Value::as_str)
            .ok_or(())?
            .to_owned(),
        table_id: uuid(object.get("tableId"))?,
        created_at: graphql_timestamp(object.get("createdAt").ok_or(())?).ok_or(())?,
        updated_at: graphql_timestamp(object.get("updatedAt").ok_or(())?).ok_or(())?,
    })
    .map_err(|_| ())?;
    notifications::compose_active_notifications(document, object)
}

pub(super) fn patch(
    record_key: RecordKey,
    object: &Object,
    updated_at_fallback_ms: Option<i64>,
) -> Result<OptimisticProjectionMutation, ()> {
    let mut exact: Vec<_> = direct_patch::owner(object)?.into_iter().collect();
    if object.contains_key("tableId") {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::table_id(),
            values: vec![ExactValue::new(uuid(object.get("tableId"))?.as_bytes()).map_err(|_| ())?],
        });
    }
    if object.contains_key("notifications") {
        exact.extend(notifications::snapshot_patches(&record_key, object)?);
    }
    let (integers, sorts) = direct_patch::timestamps(object, updated_at_fallback_ms)?;
    Ok(OptimisticProjectionMutation::Patch {
        record_key,
        profile: vocabulary::profile_v4(),
        partition: vocabulary::database_row_partition(),
        exact,
        integers,
        sorts,
    })
}
