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
/// Maximum scalar fields used to initialize one embedded list item.
pub const MAX_INSERT_FIELDS: usize = 16;

/// One constrained step through an embedded cache value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LinkPathSegment {
    /// Selects a field on the current embedded object.
    Field {
        /// Exact cache field key selected by the query path.
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LinkOperation {
    /// Removes every occurrence of the entity reference.
    Remove {
        /// Normalized entity key to remove.
        #[serde(rename = "entityKey")]
        entity_key: EntityKey<'static>,
    },
    /// Removes every occurrence and inserts one reference at the front.
    PrependUnique {
        /// Normalized entity key to prepend.
        #[serde(rename = "entityKey")]
        entity_key: EntityKey<'static>,
    },
    /// Removes a link from a matching embedded list item and decrements its
    /// count when the link was present.
    RemoveEmbeddedLink {
        /// Scalar selector identifying the embedded list item.
        #[serde(rename = "listItem")]
        list_item: ListItemByScalar,
        /// Field on the embedded item containing normalized links.
        #[serde(rename = "linkField")]
        link_field: FieldKey,
        /// Non-negative integer field tracking the complete link count.
        #[serde(rename = "countField")]
        count_field: FieldKey,
        /// Normalized entity key to remove from the link field.
        #[serde(rename = "entityKey")]
        entity_key: EntityKey<'static>,
    },
    /// Prepends a link inside a matching embedded list item, creating that
    /// embedded item when it is absent, and increments its link count.
    UpsertEmbeddedLink {
        /// Scalar selector identifying the embedded list item.
        #[serde(rename = "listItem")]
        list_item: ListItemByScalar,
        /// Field on the embedded item containing normalized links.
        #[serde(rename = "linkField")]
        link_field: FieldKey,
        /// Non-negative integer field tracking the complete link count.
        #[serde(rename = "countField")]
        count_field: FieldKey,
        /// Normalized entity key to prepend to the link field.
        #[serde(rename = "entityKey")]
        entity_key: EntityKey<'static>,
        /// Additional scalar fields used only when creating the embedded item.
        #[serde(rename = "insertFields")]
        insert_fields: HashMap<FieldKey, Json>,
    },
}

impl LinkOperation {
    fn entity_key(&self) -> EntityKey<'_> {
        match self {
            Self::Remove { entity_key }
            | Self::PrependUnique { entity_key }
            | Self::RemoveEmbeddedLink { entity_key, .. }
            | Self::UpsertEmbeddedLink { entity_key, .. } => entity_key.borrowed(),
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
    MissingParent(EntityKey<'static>),
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
    /// An embedded link count was absent or not a non-negative integer.
    #[error("embedded link count must be a non-negative integer")]
    InvalidLinkCount,
    /// Incrementing an embedded link count exceeded the stored integer range.
    #[error("embedded link count overflow")]
    LinkCountOverflow,
    /// Too many scalar fields were supplied for an embedded item insertion.
    #[error("embedded insert field count {actual} exceeds limit {maximum}")]
    TooManyInsertFields { actual: usize, maximum: usize },
    /// An embedded item insertion field conflicts with a managed field.
    #[error("embedded insert field `{0}` conflicts with a managed field")]
    ConflictingInsertField(String),
    /// Two managed embedded-item fields resolve to the same storage key.
    #[error("embedded managed fields `{first}` and `{second}` conflict")]
    ConflictingManagedField { first: String, second: String },
    /// Embedded item insertion values must be JSON scalars.
    #[error("embedded insert field values must be JSON scalars")]
    NonScalarInsertField,
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
    match &patch.operation {
        LinkOperation::RemoveEmbeddedLink {
            list_item,
            link_field,
            count_field,
            ..
        } => validate_embedded_link_fields(list_item, link_field, count_field)?,
        LinkOperation::UpsertEmbeddedLink {
            list_item,
            link_field,
            count_field,
            insert_fields,
            ..
        } => {
            validate_embedded_link_fields(list_item, link_field, count_field)?;
            if insert_fields.len() > MAX_INSERT_FIELDS {
                return Err(LinkPatchError::TooManyInsertFields {
                    actual: insert_fields.len(),
                    maximum: MAX_INSERT_FIELDS,
                });
            }
            for managed in [&list_item.where_field, link_field, count_field] {
                if insert_fields.contains_key(managed) {
                    return Err(LinkPatchError::ConflictingInsertField(managed.clone()));
                }
            }
            if insert_fields.values().any(|value| !is_json_scalar(value)) {
                return Err(LinkPatchError::NonScalarInsertField);
            }
        }
        LinkOperation::Remove { .. } | LinkOperation::PrependUnique { .. } => {}
    }
    Ok(())
}

fn validate_embedded_link_fields(
    list_item: &ListItemByScalar,
    link_field: &FieldKey,
    count_field: &FieldKey,
) -> Result<(), LinkPatchError> {
    if !is_json_scalar(&list_item.equals) {
        return Err(LinkPatchError::NonScalarSelector);
    }
    if list_item.where_field == *link_field {
        return Err(LinkPatchError::ConflictingManagedField {
            first: list_item.where_field.clone(),
            second: link_field.clone(),
        });
    }
    if list_item.where_field == *count_field {
        return Err(LinkPatchError::ConflictingManagedField {
            first: list_item.where_field.clone(),
            second: count_field.clone(),
        });
    }
    if link_field == count_field {
        return Err(LinkPatchError::ConflictingManagedField {
            first: link_field.clone(),
            second: count_field.clone(),
        });
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

fn validate_entity_key<'a>(key: EntityKey<'a>) -> Result<(), LinkPatchError> {
    let Some((typename, value)) = key.0.split_once(':') else {
        return Err(LinkPatchError::InvalidEntityKey(key.0.to_string()));
    };
    let valid_name = !typename.is_empty()
        && typename.chars().enumerate().all(|(index, ch)| {
            ch == '_' || ch.is_ascii_alphabetic() || (index > 0 && ch.is_ascii_digit())
        });
    if !valid_name || value.is_empty() || value.chars().any(char::is_whitespace) {
        return Err(LinkPatchError::InvalidEntityKey(key.0.to_string()));
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
    effective: &mut HashMap<EntityKey<'static>, Record>,
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
    effective: &mut HashMap<EntityKey<'static>, Record>,
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
            parent: resolved.parent_entity_key.0.to_string(),
            field: resolved.field_key.clone(),
        })?;
    let target = traverse(&mut field_value, &resolved.path)?;
    match &patch.operation {
        LinkOperation::Remove { entity_key } => {
            let links = normalized_links(target)?;
            links.retain(
                |value| !matches!(value, CacheValue::Ref(key) if key.as_ref() == entity_key.as_ref()),
            );
        }
        LinkOperation::PrependUnique { entity_key } => {
            prepend_unique(normalized_links(target)?, entity_key.borrowed());
        }
        LinkOperation::RemoveEmbeddedLink { entity_key, .. } => {
            let fields = resolved
                .embedded_link
                .as_ref()
                .ok_or(LinkPatchError::WrongShape)?;
            remove_embedded_link(
                target,
                &fields.list_item,
                &fields.link_field,
                &fields.count_field,
                entity_key.borrowed(),
            )?;
        }
        LinkOperation::UpsertEmbeddedLink { entity_key, .. } => {
            let fields = resolved
                .embedded_link
                .as_ref()
                .ok_or(LinkPatchError::WrongShape)?;
            upsert_embedded_link(
                target,
                &fields.list_item,
                &fields.link_field,
                &fields.count_field,
                entity_key.borrowed(),
                &fields.insert_fields,
            )?;
        }
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

fn normalized_links(value: &mut CacheValue) -> Result<&mut Vec<CacheValue>, LinkPatchError> {
    let CacheValue::List(links) = value else {
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
    Ok(links)
}

fn prepend_unique(links: &mut Vec<CacheValue>, entity_key: EntityKey<'_>) {
    links.retain(
        |value| !matches!(value, CacheValue::Ref(key) if key.as_ref() == entity_key.as_ref()),
    );
    links.insert(0, CacheValue::Ref(entity_key.into_owned()));
}

fn remove_embedded_link(
    value: &mut CacheValue,
    list_item: &ListItemByScalar,
    link_field: &FieldKey,
    count_field: &FieldKey,
    entity_key: EntityKey<'_>,
) -> Result<(), LinkPatchError> {
    let items = embedded_items(value)?;
    let index =
        embedded_item_index(items, list_item)?.ok_or(LinkPatchError::SelectorMatchCount(0))?;
    let CacheValue::Object(object) = &mut items[index] else {
        return Err(LinkPatchError::WrongShape);
    };
    let links = object
        .get_mut(link_field)
        .ok_or(LinkPatchError::WrongShape)?;
    let links = normalized_links(links)?;
    let was_present = contains_link(links, &entity_key);
    links.retain(
        |value| !matches!(value, CacheValue::Ref(key) if key.as_ref() == entity_key.as_ref()),
    );
    if was_present {
        adjust_link_count(object, count_field, CountAdjustment::Decrement)?;
    }
    Ok(())
}

fn upsert_embedded_link(
    value: &mut CacheValue,
    list_item: &ListItemByScalar,
    link_field: &FieldKey,
    count_field: &FieldKey,
    entity_key: EntityKey<'_>,
    insert_fields: &HashMap<FieldKey, Json>,
) -> Result<(), LinkPatchError> {
    let items = embedded_items(value)?;
    match embedded_item_index(items, list_item)? {
        Some(index) => {
            let CacheValue::Object(object) = &mut items[index] else {
                return Err(LinkPatchError::WrongShape);
            };
            let links = object
                .get_mut(link_field)
                .ok_or(LinkPatchError::WrongShape)?;
            let links = normalized_links(links)?;
            let was_present = contains_link(links, &entity_key);
            prepend_unique(links, entity_key);
            if !was_present {
                adjust_link_count(object, count_field, CountAdjustment::Increment)?;
            }
        }
        None => {
            let mut object = insert_fields
                .iter()
                .map(|(field, value)| Ok((field.clone(), cache_scalar(value)?)))
                .collect::<Result<std::collections::BTreeMap<_, _>, LinkPatchError>>()?;
            object.insert(
                list_item.where_field.clone(),
                cache_scalar(&list_item.equals)?,
            );
            object.insert(
                count_field.clone(),
                CacheValue::Number(CacheNumber::PosInt(1)),
            );
            object.insert(
                link_field.clone(),
                CacheValue::List(vec![CacheValue::Ref(entity_key.into_owned())]),
            );
            items.insert(0, CacheValue::Object(object));
        }
    }
    Ok(())
}

fn embedded_items(value: &mut CacheValue) -> Result<&mut Vec<CacheValue>, LinkPatchError> {
    let CacheValue::List(items) = value else {
        return Err(LinkPatchError::WrongShape);
    };
    if items.len() > MAX_TRAVERSED_LIST {
        return Err(LinkPatchError::ListTooLarge {
            actual: items.len(),
            maximum: MAX_TRAVERSED_LIST,
        });
    }
    if items
        .iter()
        .any(|value| !matches!(value, CacheValue::Object(_)))
    {
        return Err(LinkPatchError::WrongShape);
    }
    Ok(items)
}

fn embedded_item_index(
    items: &[CacheValue],
    list_item: &ListItemByScalar,
) -> Result<Option<usize>, LinkPatchError> {
    let matches: Vec<_> = items
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
    match matches.as_slice() {
        [] => Ok(None),
        [index] => Ok(Some(*index)),
        _ => Err(LinkPatchError::SelectorMatchCount(matches.len())),
    }
}

fn contains_link(links: &[CacheValue], entity_key: &EntityKey<'_>) -> bool {
    links
        .iter()
        .any(|value| matches!(value, CacheValue::Ref(key) if key.as_ref() == entity_key.as_ref()))
}

#[derive(Clone, Copy)]
enum CountAdjustment {
    Increment,
    Decrement,
}

fn adjust_link_count(
    object: &mut std::collections::BTreeMap<FieldKey, CacheValue>,
    count_field: &FieldKey,
    adjustment: CountAdjustment,
) -> Result<(), LinkPatchError> {
    let Some(CacheValue::Number(CacheNumber::PosInt(count))) = object.get_mut(count_field) else {
        return Err(LinkPatchError::InvalidLinkCount);
    };
    *count = match adjustment {
        CountAdjustment::Increment => count
            .checked_add(1)
            .ok_or(LinkPatchError::LinkCountOverflow)?,
        CountAdjustment::Decrement => count.saturating_sub(1),
    };
    Ok(())
}

fn cache_scalar(value: &Json) -> Result<CacheValue, LinkPatchError> {
    match value {
        Json::Null => Ok(CacheValue::Null),
        Json::Bool(value) => Ok(CacheValue::Bool(*value)),
        Json::Number(value) => Ok(CacheValue::Number(value.into())),
        Json::String(value) => Ok(CacheValue::String(value.clone())),
        Json::Array(_) | Json::Object(_) => Err(LinkPatchError::NonScalarInsertField),
    }
}

#[derive(Debug)]
struct ResolvedTarget {
    parent_entity_key: EntityKey<'static>,
    field_key: FieldKey,
    path: Vec<LinkPathSegment>,
    embedded_link: Option<ResolvedEmbeddedLink>,
}

#[derive(Debug)]
struct ResolvedEmbeddedLink {
    list_item: ListItemByScalar,
    link_field: FieldKey,
    count_field: FieldKey,
    insert_fields: HashMap<FieldKey, Json>,
}

/// Returns the next normalized record required to resolve one query-rooted
/// update. Engines use this to hydrate graph links from cold storage before
/// applying the update.
pub fn missing_patch_record(
    effective: &HashMap<EntityKey<'static>, Record>,
    patch: &OptimisticLinkPatch,
) -> Option<EntityKey<'static>> {
    match resolve_target(effective, patch) {
        Err(LinkPatchError::MissingParent(key)) => Some(key),
        _ => None,
    }
}

fn resolve_target(
    effective: &HashMap<EntityKey<'static>, Record>,
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
        &patch.operation,
    )
}

fn resolve_from_record(
    effective: &HashMap<EntityKey<'static>, Record>,
    owner: &EntityKey<'static>,
    type_name: &str,
    selections: &[Selection],
    variables: &serde_json::Map<String, Json>,
    path: &[LinkPathSegment],
    operation: &LinkOperation,
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
            parent: owner.0.to_string(),
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
        operation,
    )
}

struct ValueCursor<'a> {
    value: &'a CacheValue,
    owner: EntityKey<'static>,
    anchor_field: FieldKey,
    relative_path: Vec<LinkPathSegment>,
    type_name: &'a str,
    selections: &'a [Selection],
}

fn resolve_from_value(
    effective: &HashMap<EntityKey<'static>, Record>,
    variables: &serde_json::Map<String, Json>,
    cursor: ValueCursor<'_>,
    path: &[LinkPathSegment],
    operation: &LinkOperation,
) -> Result<ResolvedTarget, LinkPatchError> {
    if path.is_empty() {
        return Ok(ResolvedTarget {
            parent_entity_key: cursor.owner,
            field_key: cursor.anchor_field,
            path: cursor.relative_path,
            embedded_link: resolve_embedded_link_fields(
                cursor.selections,
                cursor.type_name,
                variables,
                operation,
            )?,
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
            operation,
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
                operation,
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
                operation,
            )
        }
        _ => Err(LinkPatchError::WrongShape),
    }
}

fn resolve_embedded_link_fields(
    selections: &[Selection],
    concrete: &str,
    variables: &serde_json::Map<String, Json>,
    operation: &LinkOperation,
) -> Result<Option<ResolvedEmbeddedLink>, LinkPatchError> {
    let (list_item, link_field, count_field, insert_fields) = match operation {
        LinkOperation::RemoveEmbeddedLink {
            list_item,
            link_field,
            count_field,
            ..
        } => (list_item, link_field, count_field, None),
        LinkOperation::UpsertEmbeddedLink {
            list_item,
            link_field,
            count_field,
            insert_fields,
            ..
        } => (list_item, link_field, count_field, Some(insert_fields)),
        LinkOperation::Remove { .. } | LinkOperation::PrependUnique { .. } => return Ok(None),
    };

    let selector_key = selected_storage_key(
        selected_field(selections, concrete, &list_item.where_field)?,
        variables,
    )?;
    let resolved_link_field =
        selected_storage_key(selected_field(selections, concrete, link_field)?, variables)?;
    let resolved_count_field = selected_storage_key(
        selected_field(selections, concrete, count_field)?,
        variables,
    )?;
    let mut resolved_insert_fields = HashMap::new();
    if let Some(insert_fields) = insert_fields {
        for (field, value) in insert_fields {
            let storage_key =
                selected_storage_key(selected_field(selections, concrete, field)?, variables)?;
            if resolved_insert_fields.contains_key(&storage_key) {
                return Err(LinkPatchError::ConflictingInsertField(storage_key));
            }
            resolved_insert_fields.insert(storage_key, value.clone());
        }
    }

    for managed in [&selector_key, &resolved_link_field, &resolved_count_field] {
        if resolved_insert_fields.contains_key(managed) {
            return Err(LinkPatchError::ConflictingInsertField(managed.clone()));
        }
    }
    if selector_key == resolved_link_field {
        return Err(LinkPatchError::ConflictingManagedField {
            first: selector_key,
            second: resolved_link_field,
        });
    }
    if selector_key == resolved_count_field {
        return Err(LinkPatchError::ConflictingManagedField {
            first: selector_key,
            second: resolved_count_field,
        });
    }
    if resolved_link_field == resolved_count_field {
        return Err(LinkPatchError::ConflictingManagedField {
            first: resolved_link_field,
            second: resolved_count_field,
        });
    }

    Ok(Some(ResolvedEmbeddedLink {
        list_item: ListItemByScalar {
            where_field: selector_key,
            equals: list_item.equals.clone(),
        },
        link_field: resolved_link_field,
        count_field: resolved_count_field,
        insert_fields: resolved_insert_fields,
    }))
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

    const QUERY: &str =
        "query { user { groupSoup { bins { key totalCount nextCursor items { id } } } } }";

    fn record() -> (EntityKey<'static>, Record) {
        let parent = EntityKey("GraphqlUser:user-1".into());
        let bin = |key: &str, total_count: u64, items: Vec<CacheValue>| {
            CacheValue::Object(BTreeMap::from([
                ("key".into(), CacheValue::String(key.into())),
                (
                    "totalCount".into(),
                    CacheValue::Number(CacheNumber::PosInt(total_count)),
                ),
                ("nextCursor".into(), CacheValue::Null),
                ("items".into(), CacheValue::List(items)),
            ]))
        };
        let grouped = CacheValue::Object(BTreeMap::from([(
            "bins".into(),
            CacheValue::List(vec![
                bin(
                    "in-progress",
                    1,
                    vec![
                        CacheValue::Ref(EntityKey("GraphqlSoupItem:task-1".into())),
                        CacheValue::Ref(EntityKey("GraphqlSoupItem:task-1".into())),
                    ],
                ),
                bin("completed", 0, vec![]),
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

    fn upsert_bin_patch(bin: &str) -> OptimisticLinkPatch {
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
            ],
            operation: LinkOperation::UpsertEmbeddedLink {
                list_item: ListItemByScalar {
                    where_field: "key".into(),
                    equals: json!(bin),
                },
                link_field: "items".into(),
                count_field: "totalCount".into(),
                entity_key: EntityKey("GraphqlSoupItem:task-1".into()),
                insert_fields: HashMap::from([("nextCursor".into(), Json::Null)]),
            },
        }
    }

    fn remove_bin_patch(bin: &str) -> OptimisticLinkPatch {
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
            ],
            operation: LinkOperation::RemoveEmbeddedLink {
                list_item: ListItemByScalar {
                    where_field: "key".into(),
                    equals: json!(bin),
                },
                link_field: "items".into(),
                count_field: "totalCount".into(),
                entity_key: EntityKey("GraphqlSoupItem:task-1".into()),
            },
        }
    }

    #[test]
    fn rejects_conflicting_embedded_managed_fields() {
        let mut direct_conflict = upsert_bin_patch("urgent");
        let LinkOperation::UpsertEmbeddedLink { link_field, .. } = &mut direct_conflict.operation
        else {
            panic!()
        };
        *link_field = "key".into();
        assert_eq!(
            deduplicate_patches(&[direct_conflict]).unwrap_err(),
            LinkPatchError::ConflictingManagedField {
                first: "key".into(),
                second: "key".into(),
            }
        );

        let (parent, initial) = record();
        let effective = HashMap::from([
            (
                EntityKey::root(),
                Record {
                    fields: BTreeMap::from([("user".into(), CacheValue::Ref(parent.clone()))]),
                },
            ),
            (parent, initial),
        ]);
        let mut resolved_conflict = upsert_bin_patch("urgent");
        resolved_conflict.query = "query { user { groupSoup { bins { selector: key link: key totalCount nextCursor items { id } } } } }".into();
        let LinkOperation::UpsertEmbeddedLink {
            list_item,
            link_field,
            ..
        } = &mut resolved_conflict.operation
        else {
            panic!()
        };
        list_item.where_field = "selector".into();
        *link_field = "link".into();
        assert_eq!(
            resolve_target(&effective, &resolved_conflict).unwrap_err(),
            LinkPatchError::ConflictingManagedField {
                first: "key".into(),
                second: "key".into(),
            }
        );
    }

    #[test]
    fn rejects_insert_fields_resolving_to_the_same_storage_key() {
        let (parent, initial) = record();
        let effective = HashMap::from([
            (
                EntityKey::root(),
                Record {
                    fields: BTreeMap::from([("user".into(), CacheValue::Ref(parent.clone()))]),
                },
            ),
            (parent, initial),
        ]);
        let mut duplicate = upsert_bin_patch("urgent");
        duplicate.query = "query { user { groupSoup { bins { key totalCount firstCursor: nextCursor secondCursor: nextCursor items { id } } } } }".into();
        let LinkOperation::UpsertEmbeddedLink { insert_fields, .. } = &mut duplicate.operation
        else {
            panic!()
        };
        *insert_fields = HashMap::from([
            ("firstCursor".into(), Json::Null),
            ("secondCursor".into(), Json::Null),
        ]);

        assert_eq!(
            resolve_target(&effective, &duplicate).unwrap_err(),
            LinkPatchError::ConflictingInsertField("nextCursor".into())
        );
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
    fn embedded_link_changes_create_bins_and_adjust_counts_once() {
        let (parent, initial) = record();
        let mut effective = HashMap::from([
            (
                EntityKey::root(),
                Record {
                    fields: BTreeMap::from([("user".into(), CacheValue::Ref(parent.clone()))]),
                },
            ),
            (parent.clone(), initial),
        ]);
        let mut updates = RecordUpdates::new();
        let urgent = upsert_bin_patch("urgent");
        apply_link_patches(
            &mut effective,
            &mut updates,
            &[urgent.clone(), urgent.clone()],
            false,
        )
        .unwrap();
        apply_link_patches(&mut effective, &mut updates, &[urgent], false).unwrap();

        let completed = upsert_bin_patch("completed");
        apply_link_patches(
            &mut effective,
            &mut updates,
            std::slice::from_ref(&completed),
            false,
        )
        .unwrap();
        apply_link_patches(&mut effective, &mut updates, &[completed], false).unwrap();

        let source = remove_bin_patch("in-progress");
        apply_link_patches(
            &mut effective,
            &mut updates,
            std::slice::from_ref(&source),
            false,
        )
        .unwrap();
        apply_link_patches(&mut effective, &mut updates, &[source], false).unwrap();

        let CacheValue::Object(grouped) = &effective[&parent].fields["groupSoup"] else {
            panic!()
        };
        let CacheValue::List(bins) = &grouped["bins"] else {
            panic!()
        };
        let CacheValue::Object(urgent) = &bins[0] else {
            panic!()
        };
        assert_eq!(urgent["key"], CacheValue::String("urgent".into()));
        assert_eq!(
            urgent["totalCount"],
            CacheValue::Number(CacheNumber::PosInt(1))
        );
        assert_eq!(urgent["nextCursor"], CacheValue::Null);
        assert_eq!(
            urgent["items"],
            CacheValue::List(vec![CacheValue::Ref(EntityKey(
                "GraphqlSoupItem:task-1".into()
            ))])
        );
        let CacheValue::Object(source) = &bins[1] else {
            panic!()
        };
        assert_eq!(
            source["totalCount"],
            CacheValue::Number(CacheNumber::PosInt(0))
        );
        assert_eq!(source["items"], CacheValue::List(vec![]));
        let CacheValue::Object(completed) = &bins[2] else {
            panic!()
        };
        assert_eq!(
            completed["totalCount"],
            CacheValue::Number(CacheNumber::PosInt(1))
        );
        assert_eq!(
            completed["items"],
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
