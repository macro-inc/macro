//! Recoverable mutation intent, stored independently of optimistic layers.
//! The catalog uses the existing records transaction and format, so adding it
//! never changes the database namespace or strands queued writes on upgrade.
use crate::{
    queue::decode_optimistic_source,
    value::{CacheValue, EntityKey, Record},
};
use serde_json::Value as Json;
use uuid::Uuid;

/// A durable enqueue was refused before any queue or optimistic state changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DurableIntentError {
    /// The exclusive entity or its committed alias is malformed.
    #[error("invalid durable intent exclusivity")]
    InvalidExclusivity,
    /// Another intent still owns delivery authority for this entity.
    #[error("Entity already has an active durable mutation")]
    ExclusiveConflict,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Exclusivity {
    entity_key: EntityKey<'static>,
    release_on: ReleaseCondition,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseCondition {
    response_path: Vec<String>,
    value: Json,
}

fn exclusivity(metadata: &Json) -> Result<Option<Exclusivity>, DurableIntentError> {
    let Some(value) = metadata.get("exclusive").filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let exclusive: Exclusivity = serde_json::from_value(value.clone())
        .map_err(|_| DurableIntentError::InvalidExclusivity)?;
    if exclusive.entity_key.typename().is_none()
        || exclusive.entity_key.id().is_none_or(str::is_empty)
        || exclusive.entity_key.as_ref().len() > 1024
        || exclusive.release_on.response_path.is_empty()
        || exclusive.release_on.response_path.len() > 16
    {
        return Err(DurableIntentError::InvalidExclusivity);
    }
    Ok(Some(exclusive))
}

fn released(row: &Json, exclusive: &Exclusivity) -> bool {
    row.get("locallyCancelled").and_then(Json::as_bool) == Some(true)
        || (row.get("phase").and_then(Json::as_str) == Some("committed")
            && exclusive
                .release_on
                .response_path
                .iter()
                .fold(row.get("response"), |value, field| {
                    value.and_then(|value| value.get(field))
                })
                == Some(&exclusive.release_on.value))
}

fn resolve_exclusive_entity<E: From<DurableIntentError>>(
    mut key: EntityKey<'static>,
    load: &mut impl FnMut(&EntityKey<'_>) -> Result<Option<Record>, E>,
) -> Result<EntityKey<'static>, E> {
    for _ in 0..crate::identity::MAX_ALIAS_CHAIN_DEPTH {
        let Some(target) = load(&key)?
            .as_ref()
            .and_then(crate::identity::alias_target)
            .cloned()
        else {
            return Ok(key);
        };
        key = target;
    }
    Err(DurableIntentError::InvalidExclusivity.into())
}

/// Enforce one active intent per entity inside the queue's write transaction.
/// Alias reads must share that transaction, so resolving a local handle and
/// admitting another tab's canonical handle cannot acquire separate authority.
pub fn check_exclusivity<E: From<DurableIntentError>>(
    catalog: &Record,
    uuid: Uuid,
    metadata: &Json,
    mut load: impl FnMut(&EntityKey<'_>) -> Result<Option<Record>, E>,
) -> Result<(), E> {
    let Some(exclusive) = exclusivity(metadata)? else {
        return Ok(());
    };
    let entity = resolve_exclusive_entity(exclusive.entity_key, &mut load)?;
    let uuid = uuid.to_string();
    for value in catalog.fields.values() {
        let CacheValue::String(value) = value else {
            continue;
        };
        let row: Json =
            serde_json::from_str(value).map_err(|_| DurableIntentError::InvalidExclusivity)?;
        if row.get("uuid").and_then(Json::as_str) == Some(uuid.as_str())
            && metadata.get("replace").and_then(Json::as_bool) == Some(true)
        {
            continue;
        }
        let Some(existing) = row.get("metadata").map(exclusivity).transpose()?.flatten() else {
            continue;
        };
        if !released(&row, &existing)
            && resolve_exclusive_entity(existing.entity_key, &mut load)? == entity
        {
            return Err(DurableIntentError::ExclusiveConflict.into());
        }
    }
    Ok(())
}

/// Reserved metadata on an optimistic response; never part of the wire request.
pub const FIELD: &str = "__durableIntent";
/// Reserved catalog record type.
pub const TYPENAME: &str = "CacheMutationIntents";
/// Catalog key shared by browser and native storage.
pub fn key() -> EntityKey<'static> {
    EntityKey::entity(TYPENAME, &["catalog"])
}

/// Read opt-in intent metadata from a persisted optimistic source.
pub fn source_metadata(source: &str) -> Option<Json> {
    decode_optimistic_source(source)
        .ok()?
        .mutation_data
        .get(FIELD)
        .filter(|v| v.is_object())
        .cloned()
}

/// Explicit cancellation replaces the old request even when its lease is live.
pub fn replaces(data: &Json) -> bool {
    data.get(FIELD)
        .and_then(|v| v.get("replace"))
        .and_then(Json::as_bool)
        == Some(true)
}

/// Merge one intent into the durable catalog at enqueue/settlement.
pub fn update(
    record: &mut Record,
    uuid: Uuid,
    metadata: &Json,
    phase: &str,
    response: Option<&Json>,
    locally_cancelled: bool,
) {
    let value = serde_json::json!({"uuid": uuid, "metadata": metadata, "phase": phase, "response": response, "locallyCancelled": locally_cancelled});
    record
        .fields
        .insert(uuid.to_string(), CacheValue::String(value.to_string()));
}

/// Decode the catalog without requiring a generated GraphQL selection.
pub fn values(record: Option<Record>) -> Vec<Json> {
    record
        .into_iter()
        .flat_map(|record| record.fields.into_values())
        .filter_map(|value| {
            if let CacheValue::String(value) = value {
                serde_json::from_str(&value).ok()
            } else {
                None
            }
        })
        .collect()
}

/// A cancellation of a cancellation must retain the original send's uncertainty.
pub fn locally_cancelled(previous: Option<&str>, source: &str, attempt_count: u32) -> bool {
    let already_cancelled = previous
        .and_then(|value| serde_json::from_str::<Json>(value).ok())
        .and_then(|value| value.get("locallyCancelled").and_then(Json::as_bool))
        == Some(true);
    let was_replacement = source_metadata(source)
        .as_ref()
        .and_then(|value| value.get("replace"))
        .and_then(Json::as_bool)
        == Some(true);
    already_cancelled || (!was_replacement && attempt_count == 0)
}
