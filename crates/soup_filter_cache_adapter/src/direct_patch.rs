//! Patch facts shared by the authoritative partitions (channels, database rows).

use super::*;
use predicate_index::{IntegerAttributePatch, IntegerFact, utc_timestamp_micros};

type Object = serde_json::Map<String, serde_json::Value>;

/// The selected fields keyed by field name rather than alias; `Err` when two
/// aliases of one field disagree.
pub(super) fn selected_object(object: &Object, fields: &[&FieldNode]) -> Result<Object, ()> {
    let mut selected = Object::new();
    for field in fields {
        let Some(value) = object.get(&field.response_key) else {
            continue;
        };
        if selected.get(&field.name).is_some_and(|old| old != value) {
            return Err(());
        }
        selected.insert(field.name.clone(), value.clone());
    }
    Ok(selected)
}

/// The non-empty `ownerId` patch, when the object carries one.
pub(super) fn owner(object: &Object) -> Result<Option<ExactAttributePatch>, ()> {
    let Some(value) = object.get("ownerId") else {
        return Ok(None);
    };
    let owner = value.as_str().filter(|owner| !owner.is_empty()).ok_or(())?;
    Ok(Some(ExactAttributePatch {
        attribute: vocabulary::owner(),
        values: vec![ExactValue::utf8(owner).map_err(|_| ())?],
    }))
}

/// `createdAt`/`updatedAt` integer and sort facts; a missing `updatedAt`
/// takes `updated_at_fallback_ms` when given.
pub(super) fn timestamps(
    object: &Object,
    updated_at_fallback_ms: Option<i64>,
) -> Result<(Vec<IntegerAttributePatch>, Vec<IntegerFact>), ()> {
    let mut integers = Vec::new();
    let mut sorts = Vec::new();
    for (field, attribute) in [
        ("createdAt", vocabulary::created_at()),
        ("updatedAt", vocabulary::updated_at()),
    ] {
        let timestamp = match object.get(field) {
            Some(value) => Some(graphql_timestamp(value).ok_or(())?),
            None if field == "updatedAt" => match updated_at_fallback_ms {
                Some(milliseconds) => {
                    Some(chrono::DateTime::from_timestamp_millis(milliseconds).ok_or(())?)
                }
                None => None,
            },
            None => None,
        };
        if let Some(timestamp) = timestamp {
            let value = utc_timestamp_micros(timestamp);
            integers.push(IntegerAttributePatch {
                attribute: attribute.clone(),
                values: vec![value],
            });
            sorts.push(IntegerFact { attribute, value });
        }
    }
    Ok((integers, sorts))
}
