//! Small changes to the effective record view, independent of its transport.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::value::{CacheValue, EntityKey, Record};

/// A scalar patch, or a record whose links/shape require a fresh query read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RecordFieldChange {
    /// Values after composing all remaining optimistic layers.
    Fields {
        /// Normalized entity identity.
        key: EntityKey<'static>,
        /// Storage field keys (including arguments), never response aliases.
        fields: BTreeMap<String, Value>,
    },
    /// Record creation, removal, identity changes, or non-scalar changes.
    Invalidate {
        /// Normalized entity identity.
        key: EntityKey<'static>,
    },
}

/// Compares effective views, so settlement never publishes hidden base changes.
pub(crate) fn between(
    before: &HashMap<EntityKey<'static>, Option<Record>>,
    after: &HashMap<EntityKey<'static>, Option<Record>>,
) -> Vec<RecordFieldChange> {
    before
        .keys()
        .chain(after.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter_map(|key| {
            let old = before.get(key).and_then(Option::as_ref);
            let new = after.get(key).and_then(Option::as_ref);
            if old == new || is_bookkeeping(key) {
                return None;
            }
            match record_change(key, old, new) {
                RecordFieldChange::Fields { fields, .. } if fields.is_empty() => None,
                change => Some(change),
            }
        })
        .collect()
}

/// Membership stamps are engine bookkeeping, never visible fields.
pub(crate) fn is_bookkeeping(key: &EntityKey<'static>) -> bool {
    key.typename() == Some(crate::membership::EVIDENCE_TYPENAME)
}

fn record_change(
    key: &EntityKey<'static>,
    before: Option<&Record>,
    after: Option<&Record>,
) -> RecordFieldChange {
    let invalidate = || RecordFieldChange::Invalidate { key: key.clone() };
    let (Some(before), Some(after)) = (before, after) else {
        return invalidate();
    };
    let mut fields = BTreeMap::new();
    for name in before
        .fields
        .keys()
        .chain(after.fields.keys())
        .collect::<BTreeSet<_>>()
    {
        if before.fields.get(name) == after.fields.get(name)
            || crate::membership::is_internal_field(name)
        {
            continue;
        }
        if name == "id" || name == "__typename" {
            return invalidate();
        }
        if !matches!(
            before.fields.get(name),
            Some(
                CacheValue::Null
                    | CacheValue::Bool(_)
                    | CacheValue::Number(_)
                    | CacheValue::String(_)
            )
        ) {
            return invalidate();
        }
        let value = match after.fields.get(name) {
            Some(CacheValue::Null) => Value::Null,
            Some(CacheValue::Bool(value)) => Value::Bool(*value),
            Some(CacheValue::Number(value)) => Value::Number(value.to_json()),
            Some(CacheValue::String(value)) => Value::String(value.clone()),
            _ => return invalidate(),
        };
        fields.insert(name.clone(), value);
    }
    RecordFieldChange::Fields {
        key: key.clone(),
        fields,
    }
}

/// Capture a partial merge without cloning the existing record or its lists.
pub(crate) fn from_update(
    key: &EntityKey<'static>,
    before: &Record,
    update: &Record,
) -> Option<RecordFieldChange> {
    if is_bookkeeping(key) {
        return None;
    }
    let mut fields = BTreeMap::new();
    for (name, value) in &update.fields {
        if before.fields.get(name) == Some(value) {
            continue;
        }
        if name == "id"
            || name == "__typename"
            || !matches!(
                before.fields.get(name),
                Some(
                    CacheValue::Null
                        | CacheValue::Bool(_)
                        | CacheValue::Number(_)
                        | CacheValue::String(_)
                )
            )
        {
            return Some(RecordFieldChange::Invalidate { key: key.clone() });
        }
        let value = match value {
            CacheValue::Null => Value::Null,
            CacheValue::Bool(value) => Value::Bool(*value),
            CacheValue::Number(value) => Value::Number(value.to_json()),
            CacheValue::String(value) => Value::String(value.clone()),
            _ => return Some(RecordFieldChange::Invalidate { key: key.clone() }),
        };
        fields.insert(name.clone(), value);
    }
    (!fields.is_empty()).then(|| RecordFieldChange::Fields {
        key: key.clone(),
        fields,
    })
}

#[cfg(test)]
mod test;
