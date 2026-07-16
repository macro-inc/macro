//! Constrained optimistic updates for link lists nested in embedded values.
//!
//! Patch recipes are transport-neutral and serializable so they can be kept
//! with durable optimistic mutations and replayed after a restart.

use crate::document::{Document, FieldNode, OperationKind, Selection};
use crate::meta;
use crate::normalize::RecordUpdates;
use crate::query_path::{
    selected_field as find_selected_field, selected_storage_key as resolve_selected_storage_key,
    selected_type as resolve_selected_type,
};
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

/// One mutation-scoped update rooted at a generated GraphQL query.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimisticLinkPatch {
    /// GraphQL query document that gives the path its typed entrypoint.
    pub query: String,
    /// Selected operation when the document contains multiple operations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_name: Option<String>,
    /// Canonical JSON object containing the query variables.
    pub variables_json: String,
    /// Response-key traversal beginning at the query root.
    pub path: Vec<LinkPathSegment>,
    /// Idempotent relation operation.
    pub operation: LinkOperation,
}

impl OptimisticLinkPatch {
    /// Query to refresh after this optimistic update commits.
    pub fn revalidation(&self) -> QueryRevalidation {
        QueryRevalidation {
            query: self.query.clone(),
            operation_name: self.operation_name.clone(),
            variables_json: self.variables_json.clone(),
        }
    }
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
    /// The selected normalized record is absent.
    #[error("link update record `{0}` is missing")]
    MissingParent(EntityKey),
    /// The selected record field is absent.
    #[error("link update field `{field}` is missing on `{parent}`")]
    MissingField { parent: String, field: String },
    /// The generated query entrypoint or variables are invalid.
    #[error("invalid link update entrypoint: {0}")]
    InvalidEntrypoint(String),
    /// A response-key path field was not selected by the query.
    #[error("query does not select `{field}` on `{type_name}`")]
    UnselectedField { type_name: String, field: String },
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
    validate_entrypoint(patch)?;
    validate_entity_key(patch.operation.entity_key())?;
    for segment in &patch.path {
        if let LinkPathSegment::ListItem { list_item } = segment
            && !is_json_scalar(&list_item.equals)
        {
            return Err(LinkPatchError::NonScalarSelector);
        }
    }
    Ok(())
}

fn validate_entrypoint(
    patch: &OptimisticLinkPatch,
) -> Result<serde_json::Map<String, Json>, LinkPatchError> {
    let document = Document::parse(&patch.query)
        .map_err(|error| LinkPatchError::InvalidEntrypoint(error.to_string()))?;
    let operation = document
        .operation(patch.operation_name.as_deref())
        .map_err(|error| LinkPatchError::InvalidEntrypoint(error.to_string()))?;
    if operation.kind != OperationKind::Query {
        return Err(LinkPatchError::InvalidEntrypoint(
            "link update entrypoint must be a query".to_string(),
        ));
    }
    let variables: Json = serde_json::from_str(&patch.variables_json)
        .map_err(|error| LinkPatchError::InvalidEntrypoint(error.to_string()))?;
    let Json::Object(variables) = variables else {
        return Err(LinkPatchError::InvalidEntrypoint(
            "entrypoint variables must be an object".to_string(),
        ));
    };
    Ok(variables)
}

fn validate_entity_key(key: &EntityKey) -> Result<(), LinkPatchError> {
    let Some((typename, value)) = key.0.split_once(':') else {
        return Err(LinkPatchError::InvalidEntityKey(key.0.clone()));
    };
    let valid_name = !typename.is_empty()
        && typename.chars().enumerate().all(|(index, ch)| {
            ch == '_' || ch.is_ascii_alphabetic() || (index > 0 && ch.is_ascii_digit())
        });
    if !valid_name || value.is_empty() || value.chars().any(char::is_whitespace) {
        return Err(LinkPatchError::InvalidEntityKey(key.0.clone()));
    }
    Ok(())
}

fn is_json_scalar(value: &Json) -> bool {
    matches!(
        value,
        Json::Null | Json::Bool(_) | Json::Number(_) | Json::String(_)
    )
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
    let resolved = resolve_target(effective, patch)?;
    let record = effective
        .get_mut(&resolved.parent_entity_key)
        .ok_or_else(|| LinkPatchError::MissingParent(resolved.parent_entity_key.clone()))?;
    let mut field_value = record
        .fields
        .get(&resolved.field_key)
        .cloned()
        .ok_or_else(|| LinkPatchError::MissingField {
            parent: resolved.parent_entity_key.0.clone(),
            field: resolved.field_key.clone(),
        })?;
    let target = traverse(&mut field_value, &resolved.path)?;
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
        .insert(resolved.field_key.clone(), field_value.clone());
    updates
        .entry(resolved.parent_entity_key)
        .or_default()
        .fields
        .insert(resolved.field_key, field_value);
    Ok(())
}

#[derive(Debug)]
struct ResolvedTarget {
    parent_entity_key: EntityKey,
    field_key: FieldKey,
    path: Vec<LinkPathSegment>,
}

/// Returns the next normalized record required to resolve one query-rooted
/// update. Engines use this to hydrate graph links from cold storage before
/// applying the update.
pub fn missing_patch_record(
    effective: &HashMap<EntityKey, Record>,
    patch: &OptimisticLinkPatch,
) -> Option<EntityKey> {
    match resolve_target(effective, patch) {
        Err(LinkPatchError::MissingParent(key)) => Some(key),
        _ => None,
    }
}

fn resolve_target(
    effective: &HashMap<EntityKey, Record>,
    patch: &OptimisticLinkPatch,
) -> Result<ResolvedTarget, LinkPatchError> {
    let variables = validate_entrypoint(patch)?;
    let document = Document::parse(&patch.query)
        .map_err(|error| LinkPatchError::InvalidEntrypoint(error.to_string()))?;
    let operation = document
        .operation(patch.operation_name.as_deref())
        .map_err(|error| LinkPatchError::InvalidEntrypoint(error.to_string()))?;
    resolve_from_record(
        effective,
        &EntityKey::root(),
        meta::QUERY_ROOT_TYPE,
        &operation.selection_set,
        &variables,
        &patch.path,
    )
}

fn resolve_from_record(
    effective: &HashMap<EntityKey, Record>,
    owner: &EntityKey,
    type_name: &str,
    selections: &[Selection],
    variables: &serde_json::Map<String, Json>,
    path: &[LinkPathSegment],
) -> Result<ResolvedTarget, LinkPatchError> {
    let Some(LinkPathSegment::Field {
        field: response_key,
    }) = path.first()
    else {
        return Err(LinkPatchError::WrongShape);
    };
    let record = effective
        .get(owner)
        .ok_or_else(|| LinkPatchError::MissingParent(owner.clone()))?;
    let concrete = record.typename().unwrap_or(type_name);
    let selected = selected_field(selections, concrete, response_key)?;
    let storage_key = selected_storage_key(selected, variables)?;
    let value = record
        .fields
        .get(&storage_key)
        .ok_or_else(|| LinkPatchError::MissingField {
            parent: owner.0.clone(),
            field: storage_key.clone(),
        })?;
    let named_type = selected_type(concrete, selected)?;
    resolve_from_value(
        effective,
        variables,
        ValueCursor {
            value,
            owner: owner.clone(),
            anchor_field: storage_key,
            relative_path: Vec::new(),
            type_name: named_type,
            selections: &selected.selection_set,
        },
        &path[1..],
    )
}

struct ValueCursor<'a> {
    value: &'a CacheValue,
    owner: EntityKey,
    anchor_field: FieldKey,
    relative_path: Vec<LinkPathSegment>,
    type_name: &'a str,
    selections: &'a [Selection],
}

fn resolve_from_value(
    effective: &HashMap<EntityKey, Record>,
    variables: &serde_json::Map<String, Json>,
    cursor: ValueCursor<'_>,
    path: &[LinkPathSegment],
) -> Result<ResolvedTarget, LinkPatchError> {
    if path.is_empty() {
        return Ok(ResolvedTarget {
            parent_entity_key: cursor.owner,
            field_key: cursor.anchor_field,
            path: cursor.relative_path,
        });
    }

    if let CacheValue::Ref(key) = cursor.value {
        return resolve_from_record(
            effective,
            key,
            cursor.type_name,
            cursor.selections,
            variables,
            path,
        );
    }

    match (&path[0], cursor.value) {
        (
            LinkPathSegment::Field {
                field: response_key,
            },
            CacheValue::Object(object),
        ) => {
            let concrete = object
                .get("__typename")
                .and_then(|value| match value {
                    CacheValue::String(value) => Some(value.as_str()),
                    _ => None,
                })
                .unwrap_or(cursor.type_name);
            let selected = selected_field(cursor.selections, concrete, response_key)?;
            let storage_key = selected_storage_key(selected, variables)?;
            let child = object.get(&storage_key).ok_or(LinkPatchError::WrongShape)?;
            let mut child_path = cursor.relative_path;
            child_path.push(LinkPathSegment::Field {
                field: storage_key.clone(),
            });
            resolve_from_value(
                effective,
                variables,
                ValueCursor {
                    value: child,
                    owner: cursor.owner,
                    anchor_field: cursor.anchor_field,
                    relative_path: child_path,
                    type_name: selected_type(concrete, selected)?,
                    selections: &selected.selection_set,
                },
                &path[1..],
            )
        }
        (LinkPathSegment::ListItem { list_item }, CacheValue::List(items)) => {
            if items.len() > MAX_TRAVERSED_LIST {
                return Err(LinkPatchError::ListTooLarge {
                    actual: items.len(),
                    maximum: MAX_TRAVERSED_LIST,
                });
            }
            let selector =
                selected_field(cursor.selections, cursor.type_name, &list_item.where_field)?;
            let selector_key = selected_storage_key(selector, variables)?;
            let matches: Vec<_> = items
                .iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    let CacheValue::Object(object) = value else {
                        return None;
                    };
                    object
                        .get(&selector_key)
                        .is_some_and(|value| cache_scalar_equals(value, &list_item.equals))
                        .then_some(index)
                })
                .collect();
            if matches.len() != 1 {
                return Err(LinkPatchError::SelectorMatchCount(matches.len()));
            }
            let mut item_path = cursor.relative_path;
            item_path.push(LinkPathSegment::ListItem {
                list_item: ListItemByScalar {
                    where_field: selector_key,
                    equals: list_item.equals.clone(),
                },
            });
            resolve_from_value(
                effective,
                variables,
                ValueCursor {
                    value: &items[matches[0]],
                    owner: cursor.owner,
                    anchor_field: cursor.anchor_field,
                    relative_path: item_path,
                    type_name: cursor.type_name,
                    selections: cursor.selections,
                },
                &path[1..],
            )
        }
        _ => Err(LinkPatchError::WrongShape),
    }
}

fn selected_field<'a>(
    selections: &'a [Selection],
    concrete: &str,
    response_key: &str,
) -> Result<&'a FieldNode, LinkPatchError> {
    find_selected_field(selections, concrete, response_key).ok_or_else(|| {
        LinkPatchError::UnselectedField {
            type_name: concrete.to_string(),
            field: response_key.to_string(),
        }
    })
}

fn selected_storage_key(
    field: &FieldNode,
    variables: &serde_json::Map<String, Json>,
) -> Result<FieldKey, LinkPatchError> {
    resolve_selected_storage_key(field, variables)
        .map_err(|error| LinkPatchError::InvalidEntrypoint(error.to_string()))
}

fn selected_type(concrete: &str, field: &FieldNode) -> Result<&'static str, LinkPatchError> {
    resolve_selected_type(concrete, field).ok_or_else(|| LinkPatchError::UnselectedField {
        type_name: concrete.to_string(),
        field: field.response_key.clone(),
    })
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

    const QUERY: &str = "query { user { groupSoup { bins { key items { id } } } } }";

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
            fields: BTreeMap::from([("groupSoup".into(), grouped)]),
        };
        (parent, record)
    }

    fn patch(bin: &str, operation: LinkOperation) -> OptimisticLinkPatch {
        OptimisticLinkPatch {
            query: QUERY.into(),
            operation_name: None,
            variables_json: "{}".into(),
            path: vec![
                LinkPathSegment::Field {
                    field: "user".into(),
                },
                LinkPathSegment::Field {
                    field: "groupSoup".into(),
                },
                LinkPathSegment::Field {
                    field: "bins".into(),
                },
                LinkPathSegment::ListItem {
                    list_item: ListItemByScalar {
                        where_field: "key".into(),
                        equals: json!(bin),
                    },
                },
                LinkPathSegment::Field {
                    field: "items".into(),
                },
            ],
            operation,
        }
    }

    #[test]
    fn remove_and_prepend_compose_without_touching_unrelated_values() {
        let (parent, initial) = record();
        let mut effective = HashMap::from([
            (
                EntityKey::root(),
                Record {
                    fields: BTreeMap::from([("user".into(), CacheValue::Ref(parent.clone()))]),
                },
            ),
            (parent.clone(), initial.clone()),
        ]);
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
        let CacheValue::Object(grouped) = &changed.fields["groupSoup"] else {
            panic!()
        };
        let CacheValue::List(bins) = &grouped["bins"] else {
            panic!()
        };
        let CacheValue::Object(source) = &bins[0] else {
            panic!()
        };
        assert_eq!(source["items"], CacheValue::List(vec![]));
        let CacheValue::Object(destination) = &bins[1] else {
            panic!()
        };
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
        let mut effective = HashMap::from([
            (
                EntityKey::root(),
                Record {
                    fields: BTreeMap::from([("user".into(), CacheValue::Ref(parent.clone()))]),
                },
            ),
            (parent, initial.clone()),
        ]);
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
        assert_eq!(
            effective.get(&EntityKey("GraphqlUser:user-1".into())),
            Some(&initial)
        );
        assert!(updates.is_empty());
    }

    #[test]
    fn rejects_non_ref_target_and_invalid_keys() {
        let (parent, mut initial) = record();
        let CacheValue::Object(grouped) = initial.fields.get_mut("groupSoup").unwrap() else {
            panic!()
        };
        let CacheValue::List(bins) = grouped.get_mut("bins").unwrap() else {
            panic!()
        };
        let CacheValue::Object(source) = &mut bins[0] else {
            panic!()
        };
        source.insert(
            "items".into(),
            CacheValue::List(vec![CacheValue::String("bad".into())]),
        );
        let mut effective = HashMap::from([
            (
                EntityKey::root(),
                Record {
                    fields: BTreeMap::from([("user".into(), CacheValue::Ref(parent.clone()))]),
                },
            ),
            (parent, initial),
        ]);
        let mut updates = RecordUpdates::new();
        assert_eq!(
            apply_link_patches(
                &mut effective,
                &mut updates,
                &[patch(
                    "in-progress",
                    LinkOperation::Remove {
                        entity_key: EntityKey("bad".into())
                    }
                )],
                false,
            ),
            Err(LinkPatchError::InvalidEntityKey("bad".into()))
        );
    }
}
