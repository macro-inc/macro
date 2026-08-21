//! Read path: normalized records → response JSON.
//!
//! Pure and synchronous: reads records through a [`RecordSource`] snapshot.
//! When records are absent from the source the walk *continues* and gathers
//! every missing key, so the engine can batch-fetch from storage and retry
//! (see the engine's read loop). A record that exists but lacks a selected
//! field is a cache miss (Phase 1: no partial results — nullability-based
//! partials are a later phase; the metadata is already generated).

use crate::document::{
    FieldNode, MissingVariable, Operation, Selection, resolve_args, resolved_args_key,
};
use crate::entity_resolver::EntityResolverLookup;
use crate::meta;
use crate::value::{CacheValue, EntityKey, Record, field_key};
use serde_json::Value as Json;
use std::collections::BTreeSet;
use thiserror::Error;

/// Synchronous view over records available right now (hot tier + any
/// batch-fetched records).
pub trait RecordSource {
    fn get(&self, key: &EntityKey<'static>) -> Option<&Record>;
}

impl RecordSource for std::collections::BTreeMap<EntityKey<'static>, Record> {
    fn get(&self, key: &EntityKey<'static>) -> Option<&Record> {
        std::collections::BTreeMap::get(self, key)
    }
}

impl RecordSource for std::collections::HashMap<EntityKey<'static>, Record> {
    fn get(&self, key: &EntityKey<'static>) -> Option<&Record> {
        std::collections::HashMap::get(self, key)
    }
}

#[derive(Debug, Error)]
pub enum DenormalizeError {
    #[error(transparent)]
    MissingVariable(#[from] MissingVariable),
    #[error("unknown field `{type_name}.{field}` (schema drift?)")]
    UnknownField { type_name: String, field: String },
    #[error("stored value for `{type_name}.{field}` does not match the selection shape")]
    Shape { type_name: String, field: String },
}

/// Outcome of a read attempt.
#[derive(Debug)]
pub enum ReadOutcome {
    /// All selected data present.
    Complete(Json),
    /// Some records weren't in the [`RecordSource`]; fetch these and retry.
    NeedRecords(BTreeSet<EntityKey<'static>>),
    /// A record exists but a selected field was never written → miss.
    Miss {
        entity: EntityKey<'static>,
        field: String,
    },
}

/// Attempts to answer `op` from `source`. `deps` accumulates every entity
/// key touched (for dependency tracking), regardless of outcome.
pub fn denormalize(
    op: &Operation,
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut BTreeSet<EntityKey<'static>>,
) -> Result<ReadOutcome, DenormalizeError> {
    denormalize_with_entity_resolvers(
        op,
        variables,
        source,
        deps,
        &EntityResolverLookup::default(),
    )
}

/// Attempts to answer `op` while applying validated read-only entity links.
pub fn denormalize_with_entity_resolvers(
    op: &Operation,
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut BTreeSet<EntityKey<'static>>,
    entity_resolvers: &EntityResolverLookup,
) -> Result<ReadOutcome, DenormalizeError> {
    denormalize_record_with_entity_resolvers(
        &EntityKey::root(),
        meta::QUERY_ROOT_TYPE,
        &op.selection_set,
        variables,
        source,
        deps,
        entity_resolvers,
    )
}

/// Projects one normalized record through a fragment selection.
pub fn denormalize_record(
    key: &EntityKey<'static>,
    type_name: &str,
    selections: &[Selection],
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut BTreeSet<EntityKey<'static>>,
) -> Result<ReadOutcome, DenormalizeError> {
    denormalize_record_with_entity_resolvers(
        key,
        type_name,
        selections,
        variables,
        source,
        deps,
        &EntityResolverLookup::default(),
    )
}

fn denormalize_record_with_entity_resolvers(
    key: &EntityKey<'static>,
    type_name: &str,
    selections: &[Selection],
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut BTreeSet<EntityKey<'static>>,
    entity_resolvers: &EntityResolverLookup,
) -> Result<ReadOutcome, DenormalizeError> {
    let mut walk = Walk {
        variables,
        source,
        deps,
        entity_resolvers,
        missing_records: BTreeSet::new(),
        miss: None,
    };
    let data = walk.read_record(key, type_name, selections)?;

    if !walk.missing_records.is_empty() {
        return Ok(ReadOutcome::NeedRecords(walk.missing_records));
    }
    if let Some((entity, field)) = walk.miss {
        return Ok(ReadOutcome::Miss { entity, field });
    }
    match data {
        Some(json) => Ok(ReadOutcome::Complete(json)),
        None => Ok(ReadOutcome::Miss {
            entity: key.clone(),
            field: "(record)".to_string(),
        }),
    }
}

struct Walk<'a, S: RecordSource> {
    variables: &'a serde_json::Map<String, Json>,
    source: &'a S,
    deps: &'a mut BTreeSet<EntityKey<'static>>,
    entity_resolvers: &'a EntityResolverLookup,
    missing_records: BTreeSet<EntityKey<'static>>,
    /// First field-level miss encountered.
    miss: Option<(EntityKey<'static>, String)>,
}

impl<'a, S: RecordSource> Walk<'a, S> {
    /// Reads a full record by key. Returns `None` when the outcome is
    /// already determined to be incomplete (missing record / miss noted).
    fn read_record(
        &mut self,
        key: &EntityKey<'static>,
        type_name: &str,
        selections: &[Selection],
    ) -> Result<Option<Json>, DenormalizeError> {
        self.deps.insert(key.clone());
        let Some(record) = self.source.get(key) else {
            self.missing_records.insert(key.clone());
            return Ok(None);
        };
        // Clone is cheap relative to the walk; keeps borrows simple.
        let record = record.clone();
        let concrete = record.typename().unwrap_or(type_name).to_string();
        self.read_fields(key, &record.fields, &concrete, selections)
    }

    /// Reads selected fields out of a record's or embedded object's map.
    fn read_fields(
        &mut self,
        owner: &EntityKey<'static>,
        fields: &std::collections::BTreeMap<String, CacheValue>,
        concrete: &str,
        selections: &[Selection],
    ) -> Result<Option<Json>, DenormalizeError> {
        let mut field_nodes = Vec::new();
        collect_fields(selections, concrete, &mut field_nodes);

        let mut out = serde_json::Map::new();
        for f in field_nodes {
            if f.name == "__typename" {
                out.insert(f.response_key.clone(), Json::String(concrete.to_string()));
                continue;
            }
            // Validate the field exists in the schema (drift protection).
            let fmeta = meta::field_meta(concrete, &f.name).ok_or_else(|| {
                DenormalizeError::UnknownField {
                    type_name: concrete.to_string(),
                    field: f.name.clone(),
                }
            })?;
            let entity_resolver = self.entity_resolvers.get(concrete, &f.name);
            let arguments = match resolve_args(f, self.variables) {
                Ok(arguments) => arguments,
                Err(_) if entity_resolver.is_some() => {
                    self.mark_miss(owner, f.name.clone());
                    continue;
                }
                Err(error) => return Err(error.into()),
            };
            let args_key = resolved_args_key(f, &arguments);
            let storage_key = field_key(&f.name, args_key.as_deref());

            if let Some(entity_resolver) = entity_resolver {
                let Some(target_key) = entity_resolver.entity_key(&arguments) else {
                    self.mark_miss(owner, storage_key);
                    continue;
                };
                let json =
                    self.read_record(&target_key, &entity_resolver.target_type, &f.selection_set)?;
                if let Some(json) = json {
                    out.insert(f.response_key.clone(), json);
                }
                continue;
            }

            let Some(value) = fields.get(&storage_key) else {
                self.mark_miss(owner, storage_key);
                continue;
            };
            let json = self.read_value(owner, f, fmeta.ty.name, value)?;
            match json {
                Some(j) => {
                    out.insert(f.response_key.clone(), j);
                }
                None => continue, // incomplete subtree already noted
            }
        }
        Ok(Some(Json::Object(out)))
    }

    fn mark_miss(&mut self, owner: &EntityKey<'static>, field: String) {
        if self.miss.is_none() {
            self.miss = Some((owner.clone(), field));
        }
    }

    fn read_value(
        &mut self,
        owner: &EntityKey<'static>,
        field: &FieldNode,
        named_type: &str,
        value: &CacheValue,
    ) -> Result<Option<Json>, DenormalizeError> {
        Ok(match value {
            CacheValue::Null => Some(Json::Null),
            CacheValue::Bool(b) => Some(Json::Bool(*b)),
            CacheValue::Number(n) => Some(Json::Number(n.to_json())),
            CacheValue::String(s) => Some(Json::String(s.clone())),
            CacheValue::Opaque(j) => {
                Some(
                    serde_json::from_str(j).map_err(|_| DenormalizeError::Shape {
                        type_name: named_type.to_string(),
                        field: field.name.clone(),
                    })?,
                )
            }
            CacheValue::List(items) => {
                let mut out = Vec::with_capacity(items.len());
                let mut complete = true;
                for item in items {
                    match self.read_value(owner, field, named_type, item)? {
                        Some(j) => out.push(j),
                        None => complete = false,
                    }
                }
                if complete {
                    Some(Json::Array(out))
                } else {
                    None
                }
            }
            CacheValue::Ref(key) => self.read_record(key, named_type, &field.selection_set)?,
            CacheValue::Object(map) => {
                let concrete = match map.get("__typename") {
                    Some(CacheValue::String(t)) => t.clone(),
                    _ => named_type.to_string(),
                };
                self.read_fields(owner, map, &concrete, &field.selection_set)?
            }
        })
    }
}

fn collect_fields<'a>(
    selections: &'a [Selection],
    concrete_type: &str,
    out: &mut Vec<&'a FieldNode>,
) {
    for sel in selections {
        match sel {
            Selection::Field(f) => out.push(f),
            Selection::Fragment {
                type_condition,
                selection_set,
            } => {
                let applies = match type_condition {
                    None => true,
                    Some(cond) => meta::type_matches(concrete_type, cond),
                };
                if applies {
                    collect_fields(selection_set, concrete_type, out);
                }
            }
        }
    }
}
