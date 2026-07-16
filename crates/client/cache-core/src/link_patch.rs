//! Constrained optimistic updates for link lists nested in embedded values.
//!
//! Patch recipes are transport-neutral and serializable so they can be kept
//! with durable optimistic mutations and replayed after a restart.

use crate::normalize::RecordUpdates;
use crate::value::{CacheNumber, CacheValue, EntityKey, FieldKey, Record, canonical_json};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use std::collections::{BTreeSet, HashMap};
use thiserror::Error;

/// Maximum number of link recipes accepted for one mutation.
pub const MAX_PATCHES: usize = 128;
/// Maximum number of path segments accepted for one recipe.
pub const MAX_PATH_DEPTH: usize = 16;
/// Maximum list length traversed by one recipe.
pub const MAX_TRAVERSED_LIST: usize = 10_000;

/// One constrained step through an embedded cache value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LinkPathSegment {
    /// Selects a field on the current embedded object.
    Field {
        /// Exact cache field key. Nested GroupSoup fields have no arguments.
        field: FieldKey,
    },
    /// Selects exactly one embedded object in the current list by a scalar field.
    ListItem {
        /// Scalar matching constraint.
        #[serde(rename = "listItem")]
        list_item: ListItemByScalar,
    },
}

/// Scalar selector for an embedded list item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItemByScalar {
    /// Field on the embedded object to inspect.
    pub where_field: FieldKey,
    /// JSON-compatible scalar value that must compare equal.
    pub equals: Json,
}

/// Idempotent operation on the selected normalized-link list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LinkOperation {
    /// Removes every occurrence of the entity reference.
    Remove {
        /// Normalized entity key to remove.
        #[serde(rename = "entityKey")]
        entity_key: EntityKey,
    },
    /// Removes every occurrence and inserts one reference at the front.
    PrependUnique {
        /// Normalized entity key to prepend.
        #[serde(rename = "entityKey")]
        entity_key: EntityKey,
    },
}

impl LinkOperation {
    fn entity_key(&self) -> &EntityKey {
        match self {
            Self::Remove { entity_key } | Self::PrependUnique { entity_key } => entity_key,
        }
    }
}

/// A query that should be fetched after a successful mutation settlement.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRevalidation {
    /// GraphQL query document text.
    pub query: String,
    /// Selected operation when the document contains multiple operations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_name: Option<String>,
    /// Canonical JSON object containing query variables.
    pub variables_json: String,
}

/// One mutation-scoped nested link-list recipe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimisticLinkPatch {
    /// Normalized record containing the argument-qualified field.
    pub parent_entity_key: EntityKey,
    /// Opaque exact field key returned by field inspection.
    pub field_key: FieldKey,
    /// Constrained traversal beginning inside the selected field value.
    pub path: Vec<LinkPathSegment>,
    /// Idempotent relation operation.
    pub operation: LinkOperation,
    /// Optional query used to recover server-owned ordering/count/cursor data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revalidate: Option<QueryRevalidation>,
}

/// Failure to validate or apply a constrained link recipe.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum LinkPatchError {
    /// Too many recipes were supplied.
    #[error("link patch count {actual} exceeds limit {maximum}")]
    TooManyPatches { actual: usize, maximum: usize },
    /// A recipe path is empty or too deep.
    #[error("invalid link patch path depth {0}")]
    InvalidDepth(usize),
    /// A normalized entity key is malformed.
    #[error("invalid normalized entity key `{0}`")]
    InvalidEntityKey(String),
    /// The selected parent record is absent.
    #[error("link patch parent `{0}` is missing")]
    MissingParent(String),
    /// The selected parent field is absent.
    #[error("link patch field `{field}` is missing on `{parent}`")]
    MissingField { parent: String, field: String },
    /// A path step encountered a value of the wrong shape.
    #[error("link patch path encountered an incompatible cache value")]
    WrongShape,
    /// A traversed list exceeds the defensive limit.
    #[error("link patch traversed list length {actual} exceeds limit {maximum}")]
    ListTooLarge { actual: usize, maximum: usize },
    /// A list selector did not resolve exactly one embedded object.
    #[error("link patch list selector matched {0} items instead of exactly one")]
    SelectorMatchCount(usize),
    /// A selector value is not a JSON scalar.
    #[error("link patch selector values must be JSON scalars")]
    NonScalarSelector,
    /// The final list contains values other than normalized refs or nulls.
    #[error("link patch target list contains non-link values")]
    NonLinkTarget,
}

/// Removes exact duplicate recipes while retaining the first occurrence and
/// preserving caller order for conflicting operations.
pub fn deduplicate_patches(
    patches: &[OptimisticLinkPatch],
) -> Result<Vec<OptimisticLinkPatch>, LinkPatchError> {
    if patches.len() > MAX_PATCHES {
        return Err(LinkPatchError::TooManyPatches {
            actual: patches.len(),
            maximum: MAX_PATCHES,
        });
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::with_capacity(patches.len());
    for patch in patches {
        validate_recipe(patch)?;
        let encoded = serde_json::to_value(patch).expect("link patch serializes");
        if seen.insert(canonical_json(&encoded)) {
            out.push(patch.clone());
        }
    }
    Ok(out)
}

fn validate_recipe(patch: &OptimisticLinkPatch) -> Result<(), LinkPatchError> {
    if patch.path.is_empty() || patch.path.len() > MAX_PATH_DEPTH {
        return Err(LinkPatchError::InvalidDepth(patch.path.len()));
    }
    validate_entity_key(&patch.parent_entity_key)?;
    validate_entity_key(patch.operation.entity_key())?;
    for segment in &patch.path {
        if let LinkPathSegment::ListItem { list_item } = segment {
            if !is_json_scalar(&list_item.equals) {
                return Err(LinkPatchError::NonScalarSelector);
            }
        }
    }
    Ok(())
}

fn validate_entity_key(key: &EntityKey) -> Result<(), LinkPatchError> {
    let Some((typename, value)) = key.0.split_once(':') else {
        return Err(LinkPatchError::InvalidEntityKey(key.0.clone()));
    };
    let valid_name = !typename.is_empty()
        && typename
            .chars()
            .enumerate()
            .all(|(index, ch)| ch == '_' || ch.is_ascii_alphabetic() || (index > 0 && ch.is_ascii_digit()));
    if !valid_name || value.is_empty() || value.chars().any(char::is_whitespace) {
        return Err(LinkPatchError::InvalidEntityKey(key.0.clone()));
    }
    Ok(())
}

fn is_json_scalar(value: &Json) -> bool {
    matches!(value, Json::Null | Json::Bool(_) | Json::Number(_) | Json::String(_))
}

/// Applies an already ordered patch set against effective records and writes
/// only changed parent fields into `updates`.
///
/// When `skip_not_applicable` is true, stale/missing recipes are ignored. This
/// mode is used during hydration and successful settlement, where stale query
/// fields must never be recreated.
pub fn apply_link_patches(
    effective: &mut HashMap<EntityKey, Record>,
    updates: &mut RecordUpdates,
    patches: &[OptimisticLinkPatch],
    skip_not_applicable: bool,
) -> Result<(), LinkPatchError> {
    let patches = deduplicate_patches(patches)?;

    // Work on clones so strict validation is all-or-nothing.
    let mut staged_effective = effective.clone();
    let mut staged_updates = updates.clone();
    for patch in &patches {
        if let Err(error) = apply_one(&mut staged_effective, &mut staged_updates, patch) {
            if skip_not_applicable {
                continue;
            }
            return Err(error);
        }
    }
    *effective = staged_effective;
    *updates = staged_updates;
    Ok(())
}

fn apply_one(
    effective: &mut HashMap<EntityKey, Record>,
    updates: &mut RecordUpdates,
    patch: &OptimisticLinkPatch,
) -> Result<(), LinkPatchError> {
    let record = effective
        .get_mut(&patch.parent_entity_key)
        .ok_or_else(|| LinkPatchError::MissingParent(patch.parent_entity_key.0.clone()))?;
    let mut field_value = record
        .fields
        .get(&patch.field_key)
        .cloned()
        .ok_or_else(|| LinkPatchError::MissingField {
            parent: patch.parent_entity_key.0.clone(),
            field: patch.field_key.clone(),
        })?;
    let target = traverse(&mut field_value, &patch.path)?;
    let CacheValue::List(links) = target else {
        return Err(LinkPatchError::WrongShape);
    };
    if links.len() > MAX_TRAVERSED_LIST {
        return Err(LinkPatchError::ListTooLarge {
            actual: links.len(),
            maximum: MAX_TRAVERSED_LIST,
        });
    }
    if links
        .iter()
        .any(|value| !matches!(value, CacheValue::Ref(_) | CacheValue::Null))
    {
        return Err(LinkPatchError::NonLinkTarget);
    }

    let entity_key = patch.operation.entity_key();
    links.retain(|value| !matches!(value, CacheValue::Ref(key) if key == entity_key));
    if matches!(patch.operation, LinkOperation::PrependUnique { .. }) {
        links.insert(0, CacheValue::Ref(entity_key.clone()));
    }

    record
        .fields
        .insert(patch.field_key.clone(), field_value.clone());
    updates
        .entry(patch.parent_entity_key.clone())
        .or_default()
        .fields
        .insert(patch.field_key.clone(), field_value);
    Ok(())
}

fn traverse<'a>(
    mut current: &'a mut CacheValue,
    path: &[LinkPathSegment],
) -> Result<&'a mut CacheValue, LinkPatchError> {
    for segment in path {
        current = match segment {
            LinkPathSegment::Field { field } => {
                let CacheValue::Object(object) = current else {
                    return Err(LinkPatchError::WrongShape);
                };
                object.get_mut(field).ok_or(LinkPatchError::WrongShape)?
            }
            LinkPathSegment::ListItem { list_item } => {
                let CacheValue::List(items) = current else {
                    return Err(LinkPatchError::WrongShape);
                };
                if items.len() > MAX_TRAVERSED_LIST {
                    return Err(LinkPatchError::ListTooLarge {
                        actual: items.len(),
                        maximum: MAX_TRAVERSED_LIST,
                    });
                }
                let matches: Vec<usize> = items
                    .iter()
                    .enumerate()
                    .filter_map(|(index, value)| {
                        let CacheValue::Object(object) = value else {
                            return None;
                        };
                        object
                            .get(&list_item.where_field)
                            .is_some_and(|value| cache_scalar_equals(value, &list_item.equals))
                            .then_some(index)
                    })
                    .collect();
                if matches.len() != 1 {
                    return Err(LinkPatchError::SelectorMatchCount(matches.len()));
                }
                &mut items[matches[0]]
            }
        };
    }
    Ok(current)
}

fn cache_scalar_equals(value: &CacheValue, expected: &Json) -> bool {
    match (value, expected) {
        (CacheValue::Null, Json::Null) => true,
        (CacheValue::Bool(actual), Json::Bool(expected)) => actual == expected,
        (CacheValue::String(actual), Json::String(expected)) => actual == expected,
        (CacheValue::Number(actual), Json::Number(expected)) => {
            cache_number_equals_json(*actual, expected)
        }
        _ => false,
    }
}

fn cache_number_equals_json(actual: CacheNumber, expected: &serde_json::Number) -> bool {
    actual.to_json() == *expected
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn record() -> (EntityKey, Record) {
        let parent = EntityKey("GraphqlUser:user-1".into());
        let bin = |key: &str, items: Vec<CacheValue>| {
            CacheValue::Object(BTreeMap::from([
                ("key".into(), CacheValue::String(key.into())),
                ("items".into(), CacheValue::List(items)),
            ]))
        };
        let grouped = CacheValue::Object(BTreeMap::from([(
            "bins".into(),
            CacheValue::List(vec![
                bin(
                    "in-progress",
                    vec![
                        CacheValue::Ref(EntityKey("GraphqlSoupItem:task-1".into())),
                        CacheValue::Ref(EntityKey("GraphqlSoupItem:task-1".into())),
                    ],
                ),
                bin("completed", vec![]),
            ]),
        )]));
        let record = Record {
            fields: BTreeMap::from([("groupSoup({})".into(), grouped)]),
        };
        (parent, record)
    }

    fn patch(bin: &str, operation: LinkOperation) -> OptimisticLinkPatch {
        OptimisticLinkPatch {
            parent_entity_key: EntityKey("GraphqlUser:user-1".into()),
            field_key: "groupSoup({})".into(),
            path: vec![
                LinkPathSegment::Field { field: "bins".into() },
                LinkPathSegment::ListItem {
                    list_item: ListItemByScalar {
                        where_field: "key".into(),
                        equals: json!(bin),
                    },
                },
                LinkPathSegment::Field { field: "items".into() },
            ],
            operation,
            revalidate: None,
        }
    }

    #[test]
    fn remove_and_prepend_compose_without_touching_unrelated_values() {
        let (parent, initial) = record();
        let mut effective = HashMap::from([(parent.clone(), initial.clone())]);
        let mut updates = RecordUpdates::new();
        apply_link_patches(
            &mut effective,
            &mut updates,
            &[
                patch(
                    "in-progress",
                    LinkOperation::Remove {
                        entity_key: EntityKey("GraphqlSoupItem:task-1".into()),
                    },
                ),
                patch(
                    "completed",
                    LinkOperation::PrependUnique {
                        entity_key: EntityKey("GraphqlSoupItem:task-1".into()),
                    },
                ),
            ],
            false,
        )
        .unwrap();

        let changed = effective.get(&parent).unwrap();
        assert_ne!(changed, &initial);
        let CacheValue::Object(grouped) = &changed.fields["groupSoup({})"] else {
            panic!()
        };
        let CacheValue::List(bins) = &grouped["bins"] else { panic!() };
        let CacheValue::Object(source) = &bins[0] else { panic!() };
        assert_eq!(source["items"], CacheValue::List(vec![]));
        let CacheValue::Object(destination) = &bins[1] else { panic!() };
        assert_eq!(
            destination["items"],
            CacheValue::List(vec![CacheValue::Ref(EntityKey(
                "GraphqlSoupItem:task-1".into()
            ))])
        );
        assert_eq!(updates.len(), 1);
    }

    #[test]
    fn strict_patch_set_has_no_partial_writes() {
        let (parent, initial) = record();
        let mut effective = HashMap::from([(parent, initial.clone())]);
        let mut updates = RecordUpdates::new();
        let result = apply_link_patches(
            &mut effective,
            &mut updates,
            &[
                patch(
                    "in-progress",
                    LinkOperation::Remove {
                        entity_key: EntityKey("GraphqlSoupItem:task-1".into()),
                    },
                ),
                patch(
                    "missing",
                    LinkOperation::PrependUnique {
                        entity_key: EntityKey("GraphqlSoupItem:task-1".into()),
                    },
                ),
            ],
            false,
        );
        assert_eq!(result, Err(LinkPatchError::SelectorMatchCount(0)));
        assert_eq!(effective.values().next(), Some(&initial));
        assert!(updates.is_empty());
    }

    #[test]
    fn rejects_non_ref_target_and_invalid_keys() {
        let (parent, mut initial) = record();
        let CacheValue::Object(grouped) = initial.fields.get_mut("groupSoup({})").unwrap() else { panic!() };
        let CacheValue::List(bins) = grouped.get_mut("bins").unwrap() else { panic!() };
        let CacheValue::Object(source) = &mut bins[0] else { panic!() };
        source.insert("items".into(), CacheValue::List(vec![CacheValue::String("bad".into())]));
        let mut effective = HashMap::from([(parent, initial)]);
        let mut updates = RecordUpdates::new();
        assert_eq!(
            apply_link_patches(
                &mut effective,
                &mut updates,
                &[patch(
                    "in-progress",
                    LinkOperation::Remove { entity_key: EntityKey("bad".into()) }
                )],
                false,
            ),
            Err(LinkPatchError::InvalidEntityKey("bad".into()))
        );
    }
}
