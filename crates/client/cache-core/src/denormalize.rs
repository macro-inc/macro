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
use std::borrow::Cow;
use std::collections::BTreeSet;
use thiserror::Error;

mod plan;
pub(crate) use plan::ReadPlans;
use plan::{Field, FieldSource};

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
    ReadSession::new(key, type_name, selections).resume(
        variables,
        source,
        deps,
        entity_resolvers,
        &mut ReadPlans::default(),
    )
}

/// A response under construction. Only absent record branches are suspended;
/// completed fields and list positions survive storage hydration rounds.
/// The source must remain an immutable logical snapshot until completion.
pub(crate) struct ReadSession<'a> {
    data: Json,
    pending: Vec<PendingRecord<'a>>,
    miss: Option<(EntityKey<'static>, String)>,
}

#[derive(Clone, PartialEq, Eq)]
enum ResponsePath<'a> {
    Field(&'a str),
    Index(usize),
}

struct PendingRecord<'a> {
    key: EntityKey<'static>,
    type_name: &'a str,
    selections: &'a [Selection],
    // An overwritten duplicate field still contributes dependencies and misses,
    // but must never replace the later field's output when it finishes.
    destination: Option<Vec<ResponsePath<'a>>>,
}

impl<'a> ReadSession<'a> {
    pub(crate) fn new(
        key: &EntityKey<'static>,
        type_name: &'a str,
        selections: &'a [Selection],
    ) -> Self {
        Self {
            data: Json::Null,
            pending: vec![PendingRecord {
                key: key.clone(),
                type_name,
                selections,
                destination: Some(Vec::new()),
            }],
            miss: None,
        }
    }

    pub(crate) fn resume(
        &mut self,
        variables: &serde_json::Map<String, Json>,
        source: &impl RecordSource,
        deps: &mut BTreeSet<EntityKey<'static>>,
        entity_resolvers: &EntityResolverLookup,
        plans: &mut ReadPlans<'a>,
    ) -> Result<ReadOutcome, DenormalizeError> {
        for pending in std::mem::take(&mut self.pending) {
            let retain_output = pending.destination.is_some();
            let mut walk = Walk {
                variables,
                source,
                deps,
                entity_resolvers,
                plans,
                pending: &mut self.pending,
                miss: &mut self.miss,
                path: pending.destination.unwrap_or_default(),
                retain_output,
            };
            let data = walk.read_record(&pending.key, pending.type_name, pending.selections)?;
            if retain_output {
                let mut slot = &mut self.data;
                for segment in walk.path {
                    slot = match segment {
                        ResponsePath::Field(field) => slot.get_mut(field),
                        ResponsePath::Index(index) => slot.get_mut(index),
                    }
                    .expect("suspended response slot remains present");
                }
                *slot = data;
            }
        }
        if !self.pending.is_empty() {
            return Ok(ReadOutcome::NeedRecords(
                self.pending
                    .iter()
                    .map(|pending| pending.key.clone())
                    .collect(),
            ));
        }
        if let Some((entity, field)) = self.miss.take() {
            return Ok(ReadOutcome::Miss { entity, field });
        }
        Ok(ReadOutcome::Complete(self.data.take()))
    }
}

struct Walk<'a, 'document, S: RecordSource> {
    variables: &'a serde_json::Map<String, Json>,
    source: &'a S,
    deps: &'a mut BTreeSet<EntityKey<'static>>,
    entity_resolvers: &'a EntityResolverLookup,
    plans: &'a mut ReadPlans<'document>,
    pending: &'a mut Vec<PendingRecord<'document>>,
    miss: &'a mut Option<(EntityKey<'static>, String)>,
    path: Vec<ResponsePath<'document>>,
    retain_output: bool,
}

impl<'document, S: RecordSource> Walk<'_, 'document, S> {
    fn read_record(
        &mut self,
        key: &EntityKey<'static>,
        type_name: &'document str,
        selections: &'document [Selection],
    ) -> Result<Json, DenormalizeError> {
        self.deps.insert(key.clone());
        let Some(record) = self.source.get(key) else {
            self.pending.push(PendingRecord {
                key: key.clone(),
                type_name,
                selections,
                destination: self.retain_output.then(|| self.path.clone()),
            });
            return Ok(Json::Null);
        };
        let concrete = record.typename().unwrap_or(type_name);
        self.read_fields(key, &record.fields, concrete, selections)
    }

    fn read_fields(
        &mut self,
        owner: &EntityKey<'static>,
        fields: &std::collections::BTreeMap<String, CacheValue>,
        concrete: &str,
        selections: &'document [Selection],
    ) -> Result<Json, DenormalizeError> {
        let fields_plan =
            self.plans
                .fields(selections, concrete, self.variables, self.entity_resolvers)?;
        let pending_start = self.pending.len();
        let mut out = serde_json::Map::new();
        for planned_field in fields_plan.iter() {
            let field = planned_field.node;
            self.path.push(ResponsePath::Field(&field.response_key));
            if self.pending.len() > pending_start && out.contains_key(&field.response_key) {
                for pending in &mut self.pending[pending_start..] {
                    if pending
                        .destination
                        .as_ref()
                        .is_some_and(|path| path.starts_with(&self.path))
                    {
                        pending.destination = None;
                    }
                }
            }
            let value = self.read_field(owner, fields, concrete, planned_field)?;
            self.path.pop();
            if let Some(value) = value {
                out.insert(field.response_key.clone(), value);
            }
        }
        Ok(Json::Object(out))
    }

    fn read_field(
        &mut self,
        owner: &EntityKey<'static>,
        fields: &std::collections::BTreeMap<String, CacheValue>,
        concrete: &str,
        field: &Field<'document>,
    ) -> Result<Option<Json>, DenormalizeError> {
        match &field.source {
            FieldSource::Typename => Ok(Some(Json::String(concrete.to_owned()))),
            FieldSource::Missing(key) => {
                self.mark_miss(owner, key.to_string());
                Ok(None)
            }
            FieldSource::Entity { key, type_name } => self
                .read_record(key, type_name, &field.node.selection_set)
                .map(Some),
            FieldSource::Stored { key, type_name } => {
                let Some(value) = fields.get(key.as_ref()) else {
                    self.mark_miss(owner, key.to_string());
                    return Ok(None);
                };
                self.read_value(owner, field.node, type_name, value)
                    .map(Some)
            }
        }
    }

    fn mark_miss(&mut self, owner: &EntityKey<'static>, field: String) {
        if self.miss.is_none() {
            *self.miss = Some((owner.clone(), field));
        }
    }

    fn read_value(
        &mut self,
        owner: &EntityKey<'static>,
        field: &'document FieldNode,
        named_type: &'static str,
        value: &CacheValue,
    ) -> Result<Json, DenormalizeError> {
        Ok(match value {
            CacheValue::Null => Json::Null,
            CacheValue::Bool(value) => Json::Bool(*value),
            CacheValue::Number(value) => Json::Number(value.to_json()),
            CacheValue::String(value) => Json::String(value.clone()),
            CacheValue::Opaque(value) => {
                serde_json::from_str(value).map_err(|_| DenormalizeError::Shape {
                    type_name: named_type.to_string(),
                    field: field.name.clone(),
                })?
            }
            CacheValue::List(items) => {
                let mut out = Vec::with_capacity(items.len());
                for (index, item) in items.iter().enumerate() {
                    self.path.push(ResponsePath::Index(index));
                    out.push(self.read_value(owner, field, named_type, item)?);
                    self.path.pop();
                }
                Json::Array(out)
            }
            CacheValue::Ref(key) => self.read_record(key, named_type, &field.selection_set)?,
            CacheValue::Object(map) => {
                let concrete = match map.get("__typename") {
                    Some(CacheValue::String(typename)) => typename.as_str(),
                    _ => named_type,
                };
                self.read_fields(owner, map, concrete, &field.selection_set)?
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

#[cfg(test)]
mod test;
