//! Durable bindings between optimistic entity handles and server identities.

use crate::normalize::RecordUpdates;
use crate::value::{CacheValue, EntityKey, Record};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

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

/// Extract bindings only from explicitly declared response objects of the same type.
pub fn resolve(bindings: &[IdentityBinding], data: &Value) -> Result<IdentityMap, String> {
    let mut result = IdentityMap::new();
    for binding in bindings {
        if binding.response_path.is_empty() {
            continue;
        }
        let object = binding
            .response_path
            .iter()
            .try_fold(data, |value, field| {
                value.get(field).ok_or("missing identity response object")
            })?;
        let local_type = binding
            .local_key
            .typename()
            .ok_or("invalid local identity")?;
        let typename = object
            .get("__typename")
            .and_then(Value::as_str)
            .unwrap_or(local_type);
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
        let target = EntityKey::entity(typename, &[id]);
        if target != binding.local_key {
            result.insert(binding.local_key.clone(), target);
        }
    }
    expand_reference_identities(bindings, &mut result);
    Ok(result)
}

/// Some normalized read models share the identity of the entity they preview.
pub fn expand_reference_identities(bindings: &[IdentityBinding], identities: &mut IdentityMap) {
    for binding in bindings {
        let Some(target) = identities.get(&binding.local_key).cloned() else {
            continue;
        };
        let (Some(old_id), Some(new_id)) = (binding.local_key.id(), target.id()) else {
            continue;
        };
        for field in &binding.reference_fields {
            if let Some(typename) = field.strip_suffix(".id") {
                identities.insert(
                    EntityKey::entity(typename, &[old_id]),
                    EntityKey::entity(typename, &[new_id]),
                );
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

    #[test]
    fn resolve_maps_declared_response_objects() {
        let mut bindings = vec![binding("Draft:local", &["save", "draft"])];
        bindings[0].reference_fields = vec!["Preview.id".into(), "Message.draftId".into()];
        let data = json!({ "save": { "draft": { "__typename": "Draft", "id": "server" } } });
        let identities = resolve(&bindings, &data).unwrap();
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
        assert!(resolve(&bindings, &unchanged).unwrap().is_empty());
        assert!(
            resolve(&[binding("Draft:local", &[])], &data)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn resolve_rejects_responses_that_cannot_identify_the_entity() {
        let bindings = [binding("Draft:local", &["save", "draft"])];
        assert_eq!(
            resolve(&bindings, &json!({ "save": {} })),
            Err("missing identity response object".into())
        );
        assert_eq!(
            resolve(&bindings, &json!({ "save": { "draft": { "id": "" } } })),
            Err("missing identity response id".into())
        );
        assert_eq!(
            resolve(&bindings, &json!({ "save": { "draft": { "id": null } } })),
            Err("missing identity response id".into())
        );
        let long_id = "x".repeat(MAX_IDENTITY_BYTES + 1);
        assert_eq!(
            resolve(
                &bindings,
                &json!({ "save": { "draft": { "id": long_id } } })
            ),
            Err("identity response id too long".into())
        );
        assert_eq!(
            resolve(
                &bindings,
                &json!({ "save": { "draft": { "__typename": "Message", "id": "server" } } })
            ),
            Err("identity response changed entity type".into())
        );
        assert_eq!(
            resolve(
                &[binding("local", &["save"])],
                &json!({ "save": { "id": "server" } })
            ),
            Err("invalid local identity".into())
        );
    }
}
