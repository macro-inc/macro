//! Durable bindings between optimistic entity handles and server identities.

use crate::document::{FieldNode, Operation, OperationKind, Selection};
use crate::meta::{Schema, TypeKind};
use crate::normalize::RecordUpdates;
use crate::value::{CacheValue, EntityKey, Record};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Reserved record field hiding an explicitly deleted entity.
pub const DELETED_FIELD: &str = "__cacheIdentityDeleted";
/// Reserved record field holding a redirect after a local entity commits.
pub const ALIAS_FIELD: &str = "__cacheIdentityTarget";
/// Stable coalescing key retained after the creating mutation settles.
pub const MUTATION_UUID_FIELD: &str = "__cacheIdentityMutationUuid";
/// Longest chain of committed redirects a read follows before reporting a cycle.
pub const MAX_ALIAS_CHAIN_DEPTH: usize = 16;
/// Bound on a local key or server ID, so any resolved key fits a projection key.
const MAX_IDENTITY_BYTES: usize = 1024;

/// Durable identity and current queue state accompanying an explicit record read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityStatus {
    /// Stable coalescing key, when this entity was created by a queued mutation.
    pub mutation_uuid: Option<String>,
    /// Whether the displayed entity includes an unsettled optimistic write.
    pub pending: bool,
}

/// An explicitly declared entity created by an optimistic mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityBinding {
    /// Normalized key used before the server has assigned an ID.
    pub local_key: EntityKey<'static>,
    /// Hide the record during an optimistic delete and retain its tombstone on commit.
    #[serde(default)]
    pub delete_record: bool,
    /// Response-object path whose `__typename` and `id` identify the server entity.
    pub response_path: Vec<String>,
    /// Scalar fields holding this entity's ID, qualified as `Typename.field`.
    /// A field value equal to the local ID is rewritten on commit. When the
    /// field is a type's own `id`, that type's record keyed by the local ID is
    /// also aliased, and shares this entity's lifecycle.
    #[serde(default)]
    pub reference_fields: Vec<String>,
    /// ID variable names to reconcile in post-commit query revalidations.
    #[serde(default)]
    pub revalidation_variables: Vec<String>,
}

/// Resolved identities used while reconstructing optimistic layers.
pub type IdentityMap = BTreeMap<EntityKey<'static>, EntityKey<'static>>;

/// Validate bindings before they become durable queue input.
pub fn validate(bindings: &[IdentityBinding]) -> Result<(), String> {
    if bindings.len() > 32 {
        return Err("too many optimistic identity bindings".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for binding in bindings {
        if binding.local_key.typename().is_none()
            || binding.response_path.len() > 16
            || (binding.delete_record && !binding.response_path.is_empty())
            || binding.local_key.as_ref().len() > MAX_IDENTITY_BYTES
            || binding.reference_fields.len() > 32
            || binding.revalidation_variables.len() > 32
            || !seen.insert(&binding.local_key)
        {
            return Err("invalid optimistic identity binding".into());
        }
    }
    Ok(())
}

/// How [`resolve`] types a response object that states no `__typename`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UntypedObject {
    /// As normalizing the response under the schema typed it: of the object
    /// type its field declares. One of an abstract type fails.
    Normalized,
    /// Not at all, so it fails: for a response that doesn't normalize, which
    /// a server on another schema may have sent.
    Rejected,
}

/// Extract bindings only from explicitly declared response objects of the same
/// type. Each object along a binding's path is of the type it states, else
/// as `untyped` says, and its fields are read through the fragments that
/// apply to that type, as normalizing reads them; an object of no known type
/// is read through all its fragments. `op`'s selections say each key an
/// object's `__typename` is selected under.
pub fn resolve(
    schema: &Schema,
    bindings: &[IdentityBinding],
    op: &Operation,
    data: &Value,
    untyped: UntypedObject,
) -> Result<IdentityMap, String> {
    // A binding's own resolution, its server keeping the ID included, wins
    // over one a reference field infers; those that kept it are dropped last.
    let mut result = IdentityMap::new();
    for binding in bindings {
        if binding.response_path.is_empty() {
            continue;
        }
        let local_type = binding
            .local_key
            .typename()
            .ok_or("invalid local identity")?;
        let (object, typename) =
            response_object(schema, op, &binding.response_path, data, untyped)?;
        let typename = typename.ok_or("identity response type is not stated")?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or("missing identity response id")?;
        if id.len() > MAX_IDENTITY_BYTES {
            return Err("identity response id too long".into());
        }
        if local_type != typename {
            return Err("identity response changed entity type".into());
        }
        result.insert(
            binding.local_key.clone(),
            EntityKey::entity(typename, &[id]),
        );
    }
    expand_reference_identities(bindings, &mut result);
    result.retain(|local, target| local != target);
    Ok(result)
}

/// The response object at `path` and its type, read as [`resolve`] says.
fn response_object<'a>(
    schema: &'a Schema,
    op: &'a Operation,
    path: &[String],
    data: &'a Value,
    untyped: UntypedObject,
) -> Result<(&'a Value, Option<&'a str>), String> {
    let mut typename = match op.kind {
        OperationKind::Query => Some(schema.query_root()),
        OperationKind::Mutation => schema.mutation_root(),
        OperationKind::Subscription => schema.subscription_root(),
    };
    let mut selections: Vec<&'a [Selection]> = vec![&op.selection_set];
    let mut object = data;
    for (depth, step) in path.iter().enumerate() {
        let mut fields = Vec::new();
        for selection_set in selections {
            match typename {
                Some(typename) => {
                    crate::normalize::collect_fields(schema, selection_set, typename, &mut fields);
                }
                None => all_fields(selection_set, &mut fields),
            }
        }
        fields.retain(|field| field.response_key == *step);
        let declared = typename
            .zip(fields.first())
            .and_then(|(typename, field)| schema.field_meta(typename, &field.name))
            .map(|field| field.ty.name);
        object = object.get(step).ok_or("missing identity response object")?;
        selections = fields.iter().map(|field| &*field.selection_set).collect();
        // An object above the bound one whose type can't be told is read
        // through all its fragments.
        typename = match stated_typename(&selections, object) {
            Ok(Some(stated)) => Some(stated),
            Ok(None) => declared.filter(|declared| {
                untyped == UntypedObject::Normalized
                    && schema
                        .type_meta(declared)
                        .is_some_and(|meta| meta.kind == TypeKind::Object)
            }),
            Err(error) if depth + 1 == path.len() => return Err(error),
            Err(_) => None,
        };
    }
    Ok((object, typename))
}

/// Pushes every field `selections` select, through all their fragments.
fn all_fields<'a>(selections: &'a [Selection], fields: &mut Vec<&'a FieldNode>) {
    for selection in selections {
        match selection {
            Selection::Field(field) => fields.push(field),
            Selection::Fragment { selection_set, .. } => all_fields(selection_set, fields),
        }
    }
}

/// The `__typename` `object` states under any key `selections`, the object's
/// own, select it by, an alias included, or `None` when it states none. A key
/// that a fragment on another type selects another field by is skipped: its
/// value may not be a type name. When the object holds a value only under such
/// keys, its type can't be told.
fn stated_typename<'a>(
    selections: &[&[Selection]],
    object: &'a Value,
) -> Result<Option<&'a str>, String> {
    let mut keys = ResponseKeys {
        typename: vec!["__typename"],
        other: BTreeSet::new(),
    };
    for selection_set in selections {
        keys.collect(selection_set);
    }
    let (ambiguous, typename): (Vec<&str>, Vec<&str>) = keys
        .typename
        .into_iter()
        .partition(|key| keys.other.contains(key));
    if let Some(typename) = typename
        .into_iter()
        .find_map(|key| object.get(key)?.as_str())
    {
        return Ok(Some(typename));
    }
    if ambiguous.into_iter().any(|key| object.get(key).is_some()) {
        return Err("identity response type is ambiguous".into());
    }
    Ok(None)
}

/// The response keys an object's selections select, through fragments.
struct ResponseKeys<'s> {
    /// Keys `__typename` is selected under.
    typename: Vec<&'s str>,
    /// Keys another field is selected under.
    other: BTreeSet<&'s str>,
}

impl<'s> ResponseKeys<'s> {
    fn collect(&mut self, selections: &'s [Selection]) {
        for selection in selections {
            match selection {
                Selection::Fragment { selection_set, .. } => self.collect(selection_set),
                Selection::Field(field) if field.name == "__typename" => {
                    self.typename.push(&field.response_key);
                }
                Selection::Field(field) => {
                    self.other.insert(&field.response_key);
                }
            }
        }
    }
}

/// Some normalized read models share the identity of the entity they preview.
/// An identity already in `identities` is kept: a record's own resolution
/// outranks one a reference field infers.
pub fn expand_reference_identities(bindings: &[IdentityBinding], identities: &mut IdentityMap) {
    for binding in bindings {
        let Some(target) = identities.get(&binding.local_key).cloned() else {
            continue;
        };
        let (Some(old_id), Some(new_id)) = (binding.local_key.id(), target.id()) else {
            continue;
        };
        if old_id == new_id {
            continue;
        }
        for field in &binding.reference_fields {
            if let Some(typename) = field.strip_suffix(".id") {
                identities
                    .entry(EntityKey::entity(typename, &[old_id]))
                    .or_insert_with(|| EntityKey::entity(typename, &[new_id]));
            }
        }
    }
}

/// A redirect is stored in the same atomic batch as the authoritative response.
pub fn alias_record(target: &EntityKey<'static>) -> Record {
    Record {
        fields: BTreeMap::from([(ALIAS_FIELD.into(), CacheValue::Ref(target.clone()))]),
    }
}

/// Read a previously committed identity binding from its local record.
pub fn alias_target(record: &Record) -> Option<&EntityKey<'static>> {
    match record.fields.get(ALIAS_FIELD) {
        Some(CacheValue::Ref(target)) => Some(target),
        _ => None,
    }
}

/// The fields of a record that later settlement and replay of queued writes
/// read: an alias, a coalescing UUID and a deletion tombstone.
const IDENTITY_METADATA_FIELDS: [&str; 3] = [ALIAS_FIELD, MUTATION_UUID_FIELD, DELETED_FIELD];

/// `record` with only its identity metadata, its `id` and its `__typename`,
/// or `None` when it holds no identity metadata: what a record whose copied
/// content is retired keeps.
pub fn identity_metadata(mut record: Record) -> Option<Record> {
    if !IDENTITY_METADATA_FIELDS
        .iter()
        .any(|field| record.fields.contains_key(*field))
    {
        return None;
    }
    record.fields.retain(|field, _| {
        IDENTITY_METADATA_FIELDS.contains(&field.as_str()) || field == "id" || field == "__typename"
    });
    Some(record)
}

/// Rebase normalized records and their links; arbitrary text is never rewritten.
pub fn remap_updates(
    updates: RecordUpdates,
    bindings: &[IdentityBinding],
    identities: &IdentityMap,
) -> RecordUpdates {
    let mut result = RecordUpdates::default();
    for (key, mut record) in updates {
        let typename = key.typename().unwrap_or("");
        for (field, value) in &mut record.fields {
            remap_links(value, identities);
            for binding in bindings {
                let own_id = field == "id" && key == binding.local_key;
                let foreign_id = binding
                    .reference_fields
                    .iter()
                    .any(|name| name == &format!("{typename}.{field}"));
                if (own_id || foreign_id)
                    && let Some(target) = identities.get(&binding.local_key)
                    && let (Some(old_id), Some(new_id)) = (binding.local_key.id(), target.id())
                    && *value == CacheValue::String(old_id.into())
                {
                    *value = CacheValue::String(new_id.into());
                }
            }
        }
        result
            .entry(identities.get(&key).cloned().unwrap_or(key))
            .or_default()
            .merge(record);
    }
    result
}

fn remap_links(value: &mut CacheValue, identities: &IdentityMap) {
    match value {
        CacheValue::Ref(key) => {
            if let Some(target) = identities.get(key) {
                *key = target.clone();
            }
        }
        CacheValue::List(values) => values
            .iter_mut()
            .for_each(|value| remap_links(value, identities)),
        CacheValue::Object(fields) => fields
            .values_mut()
            .for_each(|value| remap_links(value, identities)),
        _ => {}
    }
}

/// Rebase declared query ID variables without touching documents or arbitrary text.
pub fn remap_variables(json: &mut String, bindings: &[IdentityBinding], identities: &IdentityMap) {
    let Ok(Value::Object(mut variables)) = serde_json::from_str(json) else {
        return;
    };
    for binding in bindings {
        let Some(target) = identities.get(&binding.local_key) else {
            continue;
        };
        let (Some(old_id), Some(new_id)) = (binding.local_key.id(), target.id()) else {
            continue;
        };
        for name in &binding.revalidation_variables {
            if variables.get(name).and_then(Value::as_str) == Some(old_id) {
                variables.insert(name.clone(), Value::String(new_id.into()));
            }
        }
    }
    *json = crate::value::canonical_json(&Value::Object(variables));
}

/// Rebase a relation recipe alongside its entity records.
pub fn remap_patch(
    patch: &mut crate::link_patch::OptimisticLinkPatch,
    bindings: &[IdentityBinding],
    identities: &IdentityMap,
) {
    use crate::link_patch::LinkOperation;
    remap_variables(&mut patch.variables_json, bindings, identities);
    let key = match &mut patch.operation {
        LinkOperation::Remove { entity_key }
        | LinkOperation::PrependUnique { entity_key }
        | LinkOperation::UpsertByField { entity_key, .. }
        | LinkOperation::RemoveEmbeddedLink { entity_key, .. }
        | LinkOperation::UpsertEmbeddedLink { entity_key, .. } => entity_key,
    };
    if let Some(target) = identities.get(key) {
        *key = target.clone();
    }
}

/// Rebase projection keys and UUID facts using the same committed bindings.
pub fn remap_projection(
    mutation: &mut predicate_index::OptimisticProjectionMutation,
    identities: &IdentityMap,
) {
    use predicate_index::{ExactValue, OptimisticProjectionMutation as Mutation, RecordKey};
    let remap_value = |value: &mut ExactValue| {
        for (local, target) in identities {
            let old_id = local.id().and_then(|id| uuid::Uuid::parse_str(id).ok());
            let new_id = target.id().and_then(|id| uuid::Uuid::parse_str(id).ok());
            if let (Some(old_id), Some(new_id)) = (old_id, new_id)
                && value.as_bytes() == old_id.as_bytes()
            {
                *value = ExactValue::new(new_id.as_bytes()).expect("UUID fits exact value");
            }
        }
    };
    match mutation {
        Mutation::Replace(document) => document
            .exact_facts
            .iter_mut()
            .for_each(|fact| remap_value(&mut fact.value)),
        Mutation::Patch { exact, .. } => exact
            .iter_mut()
            .for_each(|patch| patch.values.iter_mut().for_each(remap_value)),
        Mutation::PatchExact { remove, insert, .. } => remove
            .iter_mut()
            .chain(insert)
            .for_each(|fact| remap_value(&mut fact.value)),
        _ => {}
    }
    let key = match mutation {
        Mutation::Replace(document) => &mut document.record_key,
        Mutation::Patch { record_key, .. }
        | Mutation::PatchExact { record_key, .. }
        | Mutation::Delete { record_key, .. }
        | Mutation::Unknown { record_key, .. } => record_key,
    };
    if let Some(target) = identities.get(&EntityKey(key.as_str().to_owned().into())) {
        // Non-empty and within twice MAX_IDENTITY_BYTES: `validate` bounds the
        // local key and `resolve` bounds the server ID that replaces its tail.
        *key = RecordKey::new(target.to_string()).expect("validated entity identity");
    }
}

/// Explicit saves can restore a deleted entity; unrelated snapshots cannot.
/// Deletes retain their tombstones in the same transaction as settlement.
pub fn apply_record_lifecycle(
    updates: &mut RecordUpdates,
    bindings: &[IdentityBinding],
    identities: &IdentityMap,
) {
    for binding in bindings {
        let key = identities
            .get(&binding.local_key)
            .unwrap_or(&binding.local_key)
            .clone();
        let Some(id) = key.id() else {
            continue;
        };
        // A preview keyed by this entity's ID has the same lifetime. Leaving
        // it readable would let an old list redisplay a discarded entity.
        let keys = std::iter::once(key.clone()).chain(binding.reference_fields.iter().filter_map(
            |field| {
                field
                    .strip_suffix(".id")
                    .map(|typename| EntityKey::entity(typename, &[id]))
            },
        ));
        for key in keys {
            if binding.delete_record {
                updates
                    .entry(key)
                    .or_default()
                    .fields
                    .insert(DELETED_FIELD.into(), CacheValue::Bool(true));
            } else if !binding.response_path.is_empty()
                && let Some(record) = updates.get_mut(&key)
            {
                record
                    .fields
                    .insert(DELETED_FIELD.into(), CacheValue::Bool(false));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn binding(local_key: &str, response_path: &[&str]) -> IdentityBinding {
        IdentityBinding {
            local_key: EntityKey(local_key.to_owned().into()),
            delete_record: false,
            response_path: response_path.iter().map(|s| (*s).to_owned()).collect(),
            reference_fields: vec![],
            revalidation_variables: vec![],
        }
    }

    #[test]
    fn validate_rejects_malformed_bindings() {
        assert_eq!(validate(&[binding("Draft:local", &["draft"])]), Ok(()));
        let too_many = vec![binding("Draft:local", &[]); 33];
        assert_eq!(
            validate(&too_many),
            Err("too many optimistic identity bindings".into())
        );
        let invalid = "invalid optimistic identity binding".to_owned();
        assert_eq!(
            validate(&[binding("no-typename", &[])]),
            Err(invalid.clone())
        );
        let deep = vec!["a"; 17];
        assert_eq!(
            validate(&[binding("Draft:local", &deep)]),
            Err(invalid.clone())
        );
        let mut delete = binding("Draft:local", &["draft"]);
        delete.delete_record = true;
        assert_eq!(validate(&[delete]), Err(invalid.clone()));
        let long_key = format!("Draft:{}", "x".repeat(1024));
        assert_eq!(validate(&[binding(&long_key, &[])]), Err(invalid.clone()));
        let mut wide = binding("Draft:local", &[]);
        wide.reference_fields = vec!["Draft.id".into(); 33];
        assert_eq!(validate(&[wide]), Err(invalid.clone()));
        let mut variables = binding("Draft:local", &[]);
        variables.revalidation_variables = vec!["id".into(); 33];
        assert_eq!(validate(&[variables]), Err(invalid.clone()));
        assert_eq!(
            validate(&[
                binding("Draft:local", &[]),
                binding("Draft:local", &["draft"])
            ]),
            Err(invalid)
        );
    }

    /// A schema with a field of each kind a binding's response object can sit in.
    const SDL: &str = "type Query { ok: Boolean } \
        type Mutation { save: SavePayload result: SaveResult } \
        type SavePayload { draft: Draft message: Message saved: Result other: Other } \
        union Result = Saved | Other \
        union SaveResult = APayload | BPayload \
        type APayload { record: Saved child: Child } \
        type BPayload { record: Other child: Child } \
        type Child { id: ID! label: String record: Saved } \
        type Draft { id: ID! } type Message { id: ID! } \
        type Saved { id: ID! label: String } type Other { id: ID! label: String }";
    const DRAFT: &str = "mutation Save { save { draft { __typename id } } }";

    /// Resolves `bindings` from `data` as the response to `document`, which
    /// normalized.
    fn resolve_in(
        document: &str,
        bindings: &[IdentityBinding],
        data: &Value,
    ) -> Result<IdentityMap, String> {
        resolve_as(document, bindings, data, UntypedObject::Normalized)
    }

    fn resolve_as(
        document: &str,
        bindings: &[IdentityBinding],
        data: &Value,
        untyped: UntypedObject,
    ) -> Result<IdentityMap, String> {
        let schema = Schema::from_sdl(SDL).unwrap();
        let document = crate::document::Document::parse(document).unwrap();
        resolve(
            &schema,
            bindings,
            document.operation(None).unwrap(),
            data,
            untyped,
        )
    }

    #[test]
    fn resolve_maps_declared_response_objects() {
        let mut bindings = vec![binding("Draft:local", &["save", "draft"])];
        bindings[0].reference_fields = vec!["Preview.id".into(), "Message.draftId".into()];
        let data = json!({ "save": { "draft": { "__typename": "Draft", "id": "server" } } });
        let identities = resolve_in(DRAFT, &bindings, &data).unwrap();
        assert_eq!(
            identities,
            IdentityMap::from([
                (
                    EntityKey::entity("Draft", &["local"]),
                    EntityKey::entity("Draft", &["server"])
                ),
                (
                    EntityKey::entity("Preview", &["local"]),
                    EntityKey::entity("Preview", &["server"])
                ),
            ])
        );
        let unchanged = json!({ "save": { "draft": { "id": "local" } } });
        assert!(resolve_in(DRAFT, &bindings, &unchanged).unwrap().is_empty());
        assert!(
            resolve_in(DRAFT, &[binding("Draft:local", &[])], &data)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn resolve_rejects_responses_that_cannot_identify_the_entity() {
        let bindings = [binding("Draft:local", &["save", "draft"])];
        let rejects = |data: Value| resolve_in(DRAFT, &bindings, &data).unwrap_err();
        assert_eq!(
            rejects(json!({ "save": {} })),
            "missing identity response object"
        );
        assert_eq!(
            rejects(json!({ "save": { "draft": { "id": "" } } })),
            "missing identity response id"
        );
        assert_eq!(
            rejects(json!({ "save": { "draft": { "id": null } } })),
            "missing identity response id"
        );
        let long_id = "x".repeat(MAX_IDENTITY_BYTES + 1);
        assert_eq!(
            rejects(json!({ "save": { "draft": { "id": long_id } } })),
            "identity response id too long"
        );
        assert_eq!(
            rejects(json!({ "save": { "draft": { "__typename": "Message", "id": "server" } } })),
            "identity response changed entity type"
        );
        assert_eq!(
            resolve_in(
                DRAFT,
                &[binding("local", &["save"])],
                &json!({ "save": { "id": "server" } })
            ),
            Err("invalid local identity".into())
        );
    }

    #[test]
    fn resolve_takes_an_untyped_object_as_the_object_type_its_field_declares() {
        let document = "mutation Save { save { other { id } } }";
        let response = json!({ "save": { "other": { "id": "9" } } });
        assert_eq!(
            resolve_in(
                document,
                &[binding("Other:local", &["save", "other"])],
                &response
            ),
            Ok(IdentityMap::from([(
                EntityKey::entity("Other", &["local"]),
                EntityKey::entity("Other", &["9"])
            )]))
        );
        // A binding queued under a schema in which the field was a `Saved`.
        assert_eq!(
            resolve_in(
                document,
                &[binding("Saved:local", &["save", "other"])],
                &response
            ),
            Err("identity response changed entity type".into())
        );
    }

    #[test]
    fn resolve_reads_a_field_through_the_fragments_of_its_parent_type() {
        let document = "mutation Save { result { __typename \
             ... on APayload { record { id } } ... on BPayload { record { id } } } }";
        let response = json!({ "result": { "__typename": "APayload", "record": { "id": "9" } } });
        assert_eq!(
            resolve_in(
                document,
                &[binding("Saved:local", &["result", "record"])],
                &response
            ),
            Ok(IdentityMap::from([(
                EntityKey::entity("Saved", &["local"]),
                EntityKey::entity("Saved", &["9"])
            )]))
        );
        // Without the parent's type, its fragments declare two types.
        let untyped = json!({ "result": { "record": { "id": "9" } } });
        assert_eq!(
            resolve_in(
                document,
                &[binding("Saved:local", &["result", "record"])],
                &untyped
            ),
            Err("identity response type is not stated".into())
        );
    }

    #[test]
    fn resolve_reads_a_type_name_through_the_fragments_of_its_parent_type() {
        // The inactive fragment selects the child's label under the key the
        // active one selects its type name by.
        let document = "mutation Save { result { __typename \
             ... on APayload { child { kind: __typename id record { id } } } \
             ... on BPayload { child { kind: label record { id } } } } }";
        let response = json!({ "result": { "__typename": "APayload",
            "child": { "kind": "Child", "id": "4", "record": { "id": "9" } } } });
        assert_eq!(
            resolve_in(
                document,
                &[binding("Saved:local", &["result", "child", "record"])],
                &response
            ),
            Ok(IdentityMap::from([(
                EntityKey::entity("Saved", &["local"]),
                EntityKey::entity("Saved", &["9"])
            )]))
        );
        assert_eq!(
            resolve_in(
                document,
                &[binding("Child:local", &["result", "child"])],
                &response
            ),
            Ok(IdentityMap::from([(
                EntityKey::entity("Child", &["local"]),
                EntityKey::entity("Child", &["4"])
            )]))
        );
    }

    #[test]
    fn resolve_of_a_response_that_does_not_normalize_needs_a_stated_type() {
        let bindings = [binding("Other:local", &["save", "other"])];
        let unwritable = |data: Value| {
            resolve_as(
                "mutation Save { save { other { kind: __typename id } } }",
                &bindings,
                &data,
                UntypedObject::Rejected,
            )
        };
        assert_eq!(
            unwritable(json!({ "save": { "other": { "id": "9" } } })),
            Err("identity response type is not stated".into())
        );
        assert_eq!(
            unwritable(json!({ "save": { "other": { "kind": "Other", "id": "9" } } })),
            Ok(IdentityMap::from([(
                EntityKey::entity("Other", &["local"]),
                EntityKey::entity("Other", &["9"])
            )]))
        );
    }

    #[test]
    fn resolve_needs_an_object_of_an_abstract_type_to_state_it() {
        let bindings = [binding("Saved:local", &["save", "saved"])];
        let document = "mutation Save { save { saved { ... on Saved { kind: __typename id } \
             ... on Other { id } } } }";
        // An `Other`, which selects no type name.
        assert_eq!(
            resolve_in(
                document,
                &bindings,
                &json!({ "save": { "saved": { "id": "server" } } })
            ),
            Err("identity response type is not stated".into())
        );
        assert_eq!(
            resolve_in(
                document,
                &bindings,
                &json!({ "save": { "saved": { "kind": "Saved", "id": "server" } } })
            ),
            Ok(IdentityMap::from([(
                EntityKey::entity("Saved", &["local"]),
                EntityKey::entity("Saved", &["server"])
            )]))
        );
    }

    #[test]
    fn resolve_keeps_a_binding_own_identity_over_an_inferred_one() {
        let mut draft = binding("Draft:local", &["save", "draft"]);
        draft.reference_fields = vec!["Message.id".into()];
        let message = binding("Message:local", &["save", "message"]);
        let document = "mutation Save { save { draft { id } message { id } } }";
        let response = |message: &str| json!({ "save": { "draft": { "id": "1" }, "message": { "id": message } } });
        for bindings in [
            [draft.clone(), message.clone()],
            [message.clone(), draft.clone()],
        ] {
            assert_eq!(
                resolve_in(document, &bindings, &response("2")),
                Ok(IdentityMap::from([
                    (
                        EntityKey::entity("Draft", &["local"]),
                        EntityKey::entity("Draft", &["1"])
                    ),
                    (
                        EntityKey::entity("Message", &["local"]),
                        EntityKey::entity("Message", &["2"])
                    ),
                ]))
            );
            // The server kept the message's ID.
            assert_eq!(
                resolve_in(document, &bindings, &response("local")),
                Ok(IdentityMap::from([(
                    EntityKey::entity("Draft", &["local"]),
                    EntityKey::entity("Draft", &["1"])
                )]))
            );
        }
    }

    #[test]
    fn resolve_reads_a_type_selected_under_an_alias() {
        let bindings = [binding("Draft:local", &["save", "draft"])];
        let document = "mutation Save { save { draft { ... on Draft { kind: __typename } id } } }";
        let response =
            |kind: &str| json!({ "save": { "draft": { "kind": kind, "id": "server" } } });
        assert_eq!(
            resolve_in(document, &bindings, &response("Message")),
            Err("identity response changed entity type".into())
        );
        assert_eq!(
            resolve_in(document, &bindings, &response("Draft")),
            Ok(IdentityMap::from([(
                EntityKey::entity("Draft", &["local"]),
                EntityKey::entity("Draft", &["server"])
            )]))
        );
    }

    #[test]
    fn resolve_skips_a_key_another_fragment_selects_another_field_by() {
        let bindings = [binding("Saved:local", &["save", "saved"])];
        let document = "mutation Save { save { saved { ... on Saved { kind: __typename } \
             ... on Other { kind: label actual: __typename } id } } }";
        let response = json!({
            "save": { "saved": { "kind": "Saved", "actual": "Other", "id": "server" } }
        });
        assert_eq!(
            resolve_in(document, &bindings, &response),
            Err("identity response changed entity type".into())
        );
    }

    #[test]
    fn resolve_fails_when_only_an_ambiguous_key_holds_the_type() {
        let bindings = [binding("Saved:local", &["save", "saved"])];
        let document = "mutation Save { save { saved { ... on Saved { kind: __typename } \
             ... on Other { kind: label } id } } }";
        // An `Other` whose label reads as the local type.
        let response = json!({ "save": { "saved": { "kind": "Saved", "id": "server" } } });
        assert_eq!(
            resolve_in(document, &bindings, &response),
            Err("identity response type is ambiguous".into())
        );
    }
}
