//! Read path: normalized records → response JSON.
//!
//! Pure and synchronous: reads records through a [`RecordSource`] snapshot.
//! When records are absent from the source the walk *continues* and gathers
//! every missing key, so the engine can batch-fetch from storage and retry
//! (see the engine's read loop). A record that exists but lacks a selected
//! field is a cache miss (Phase 1: no partial results — nullability-based
//! partials are a later phase; the metadata is already generated).

use crate::deps::DependencyTracker;
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
mod projection;
pub(crate) use plan::ReadPlans;
use plan::{Field, FieldSource};
pub(crate) use projection::QueryProjection;

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
    Document(#[from] crate::document::DocumentError),
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
    schema: &crate::meta::Schema,
    op: &Operation,
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut impl DependencyTracker,
) -> Result<ReadOutcome, DenormalizeError> {
    denormalize_with_entity_resolvers(
        schema,
        op,
        variables,
        source,
        deps,
        &EntityResolverLookup::default(),
    )
}

/// Attempts to answer `op` while applying validated read-only entity links.
pub fn denormalize_with_entity_resolvers(
    schema: &crate::meta::Schema,
    op: &Operation,
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut impl DependencyTracker,
    entity_resolvers: &EntityResolverLookup,
) -> Result<ReadOutcome, DenormalizeError> {
    let op = op.prepare(variables)?;
    denormalize_record_with_entity_resolvers(
        schema,
        &EntityKey::root(),
        schema.query_root(),
        &op.selection_set,
        variables,
        source,
        deps,
        entity_resolvers,
    )
}

/// Projects one normalized record through a fragment selection.
pub fn denormalize_record(
    schema: &crate::meta::Schema,
    key: &EntityKey<'static>,
    type_name: &str,
    selections: &[Selection],
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut impl DependencyTracker,
) -> Result<ReadOutcome, DenormalizeError> {
    denormalize_record_with_entity_resolvers(
        schema,
        key,
        type_name,
        selections,
        variables,
        source,
        deps,
        &EntityResolverLookup::default(),
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "explicit schema and read dependencies"
)]
fn denormalize_record_with_entity_resolvers(
    schema: &crate::meta::Schema,
    key: &EntityKey<'static>,
    type_name: &str,
    selections: &[Selection],
    variables: &serde_json::Map<String, Json>,
    source: &impl RecordSource,
    deps: &mut impl DependencyTracker,
    entity_resolvers: &EntityResolverLookup,
) -> Result<ReadOutcome, DenormalizeError> {
    ReadSession::new(schema, key, type_name, selections).resume(
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
    schema: &'a crate::meta::Schema,
    data: Json,
    pub(crate) projection: Option<QueryProjection>,
    pending: Vec<PendingRecord<'a>>,
    deleted_items: BTreeSet<Vec<ResponsePath<'a>>>,
    miss: Option<(EntityKey<'static>, String)>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum ResponsePath<'a> {
    Field(&'a str),
    Index(usize),
}

#[derive(Clone, Copy)]
enum DeletedRecord {
    Miss,
    Null,
    Omit,
}

struct PendingRecord<'a> {
    deleted: DeletedRecord,
    aliases: Vec<EntityKey<'static>>,
    key: EntityKey<'static>,
    type_name: &'a str,
    selections: &'a [Selection],
    // An overwritten duplicate field still contributes dependencies and misses,
    // but must never replace the later field's output when it finishes.
    destination: Option<Vec<ResponsePath<'a>>>,
}

impl<'a> ReadSession<'a> {
    pub(crate) fn new(
        schema: &'a crate::meta::Schema,
        key: &EntityKey<'static>,
        type_name: &'a str,
        selections: &'a [Selection],
    ) -> Self {
        Self {
            schema,
            data: Json::Null,
            projection: None,
            pending: vec![PendingRecord {
                key: key.clone(),
                type_name,
                selections,
                destination: Some(Vec::new()),
                deleted: DeletedRecord::Miss,
                aliases: Vec::new(),
            }],
            deleted_items: BTreeSet::new(),
            miss: None,
        }
    }

    pub(crate) fn resume(
        &mut self,
        variables: &serde_json::Map<String, Json>,
        source: &impl RecordSource,
        deps: &mut impl DependencyTracker,
        entity_resolvers: &EntityResolverLookup,
        plans: &mut ReadPlans<'a>,
    ) -> Result<ReadOutcome, DenormalizeError> {
        for pending in std::mem::take(&mut self.pending) {
            let retain_output = pending.destination.is_some();
            let mut walk = Walk {
                schema: self.schema,
                variables,
                source,
                deps,
                entity_resolvers,
                plans,
                pending: &mut self.pending,
                deleted_items: &mut self.deleted_items,
                miss: &mut self.miss,
                path: pending.destination.unwrap_or_default(),
                retain_output,
                projection: &mut self.projection,
            };
            let data = walk.read_record(
                &pending.key,
                pending.type_name,
                pending.selections,
                pending.deleted,
                pending.aliases,
            )?;
            if retain_output {
                let mut slot = &mut self.data;
                for segment in walk.path {
                    slot = match segment {
                        ResponsePath::Field(field) => slot.get_mut(field),
                        ResponsePath::Index(index) => slot.get_mut(index),
                    }
                    .expect("suspended response slot remains present");
                }
                merge_response(slot, data);
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
        // Keep array positions stable until every suspended branch has finished.
        // Remove later indices and deeper paths first so earlier paths stay valid.
        // Compaction moves response indices; bindings move with them.
        if let Some(projection) = self.projection.as_mut() {
            projection.compact(&self.deleted_items);
        }
        for path in std::mem::take(&mut self.deleted_items).into_iter().rev() {
            let Some((ResponsePath::Index(index), parent)) = path.split_last() else {
                continue;
            };
            let mut slot = &mut self.data;
            for segment in parent {
                slot = match segment {
                    ResponsePath::Field(field) => slot.get_mut(*field),
                    ResponsePath::Index(index) => slot.get_mut(*index),
                }
                .expect("deleted response slot remains present");
            }
            slot.as_array_mut()
                .expect("deleted list item")
                .remove(*index);
        }
        Ok(ReadOutcome::Complete(self.data.take()))
    }
}

struct Walk<'a, 'document, S: RecordSource, D: DependencyTracker> {
    schema: &'document crate::meta::Schema,
    variables: &'a serde_json::Map<String, Json>,
    source: &'a S,
    deps: &'a mut D,
    entity_resolvers: &'a EntityResolverLookup,
    plans: &'a mut ReadPlans<'document>,
    pending: &'a mut Vec<PendingRecord<'document>>,
    deleted_items: &'a mut BTreeSet<Vec<ResponsePath<'document>>>,
    miss: &'a mut Option<(EntityKey<'static>, String)>,
    path: Vec<ResponsePath<'document>>,
    retain_output: bool,
    projection: &'a mut Option<QueryProjection>,
}

impl<'document, S: RecordSource, D: DependencyTracker> Walk<'_, 'document, S, D> {
    fn read_record(
        &mut self,
        key: &EntityKey<'static>,
        type_name: &'document str,
        selections: &'document [Selection],
        deleted: DeletedRecord,
        mut aliases: Vec<EntityKey<'static>>,
    ) -> Result<Json, DenormalizeError> {
        let mut key = key.clone();
        let record = loop {
            self.deps.record(&key);
            if aliases.contains(&key) || aliases.len() >= crate::identity::MAX_ALIAS_CHAIN_DEPTH {
                self.mark_miss(&key, "cyclic cache identity".into());
                return Ok(Json::Null);
            }
            let Some(record) = self.source.get(&key) else {
                self.pending.push(PendingRecord {
                    key,
                    type_name,
                    selections,
                    deleted,
                    aliases,
                    destination: self.retain_output.then(|| self.path.clone()),
                });
                return Ok(Json::Null);
            };
            if let Some(projection) = self.projection.as_mut() {
                projection.record(&key, record);
            }
            if let Some(target) = crate::identity::alias_target(record) {
                aliases.push(key);
                key = target.clone();
                continue;
            }
            break record;
        };
        if record.fields.get(crate::identity::DELETED_FIELD) == Some(&CacheValue::Bool(true)) {
            match deleted {
                DeletedRecord::Miss => self.mark_miss(&key, "deleted cache identity".into()),
                DeletedRecord::Omit if self.retain_output => {
                    self.deleted_items.insert(self.path.clone());
                }
                _ => {}
            }
            return Ok(Json::Null);
        }
        let concrete = record.typename().unwrap_or(type_name);
        self.deps.field(&key, concrete, "__typename");
        self.read_fields(&key, &record.fields, concrete, selections, true)
    }

    fn read_fields(
        &mut self,
        owner: &EntityKey<'static>,
        fields: &std::collections::BTreeMap<String, CacheValue>,
        concrete: &str,
        selections: &'document [Selection],
        normalized: bool,
    ) -> Result<Json, DenormalizeError> {
        let fields_plan = self.plans.fields(
            self.schema,
            selections,
            concrete,
            self.variables,
            self.entity_resolvers,
        )?;
        let mut out = serde_json::Map::new();
        for planned_field in fields_plan.iter() {
            let field = planned_field.node;
            self.path.push(ResponsePath::Field(&field.response_key));
            if normalized
                && self.retain_output
                && let Some(projection) = self.projection.as_mut()
            {
                match &planned_field.source {
                    FieldSource::Stored { key, ty } => {
                        let value = fields.get(key.as_ref());
                        let selection = projection::ValueProjection::compile(
                            self.schema,
                            value,
                            field,
                            ty,
                            self.variables,
                            self.entity_resolvers,
                            self.plans,
                        )?;
                        projection.selected_field(owner, key, value, &self.path, selection);
                    }
                    FieldSource::Entity { storage_key, .. } | FieldSource::Missing(storage_key) => {
                        projection.guard(owner, storage_key, fields.get(storage_key.as_ref()))
                    }
                    _ => {}
                }
            }
            let value = self.read_field(owner, fields, concrete, planned_field)?;
            self.path.pop();
            if let Some(value) = value {
                merge_response(
                    out.entry(field.response_key.clone()).or_insert(Json::Null),
                    value,
                );
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
            FieldSource::MissingArguments => {
                self.mark_miss(owner, field.node.name.clone());
                Ok(None)
            }
            FieldSource::Missing(key) => {
                self.deps.field(owner, concrete, key);
                if matches!(fields.get(key.as_ref()), Some(CacheValue::Null)) {
                    return Ok(Some(Json::Null));
                }
                self.mark_miss(owner, key.to_string());
                Ok(None)
            }
            FieldSource::Entity {
                key,
                ty,
                storage_key,
            } => {
                self.deps.field(owner, concrete, storage_key);
                // A server-observed null wins over an argument-derived relation.
                if matches!(fields.get(storage_key.as_ref()), Some(CacheValue::Null)) {
                    return Ok(Some(Json::Null));
                }
                self.read_value(owner, field.node, ty, &CacheValue::Ref(key.clone()))
                    .map(Some)
            }
            FieldSource::Stored { key, ty } => {
                self.deps.field(owner, concrete, key);
                let Some(value) = fields.get(key.as_ref()) else {
                    self.mark_miss(owner, key.to_string());
                    return Ok(None);
                };
                self.read_value(owner, field.node, ty, value).map(Some)
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
        ty: &meta::FieldType<'document>,
        value: &CacheValue,
    ) -> Result<Json, DenormalizeError> {
        Ok(match value {
            CacheValue::Null => Json::Null,
            CacheValue::Bool(value) => Json::Bool(*value),
            CacheValue::Number(value) => Json::Number(value.to_json()),
            CacheValue::String(value) => Json::String(value.clone()),
            CacheValue::Opaque(value) => {
                serde_json::from_str(value).map_err(|_| DenormalizeError::Shape {
                    type_name: ty.name.to_string(),
                    field: field.name.clone(),
                })?
            }
            CacheValue::List(items) => {
                let mut out = Vec::with_capacity(items.len());
                for (index, item) in items.iter().enumerate() {
                    self.path.push(ResponsePath::Index(index));
                    out.push(self.read_value(owner, field, ty, item)?);
                    self.path.pop();
                }
                Json::Array(out)
            }
            CacheValue::Ref(key) => self.read_record(
                key,
                ty.name,
                &field.selection_set,
                if ty.list {
                    DeletedRecord::Omit
                } else if ty.nullable {
                    DeletedRecord::Null
                } else {
                    DeletedRecord::Miss
                },
                Vec::new(),
            )?,
            CacheValue::Object(map) => {
                let concrete = match map.get("__typename") {
                    Some(CacheValue::String(typename)) => typename.as_str(),
                    _ => ty.name,
                };
                self.read_fields(owner, map, concrete, &field.selection_set, false)?
            }
        })
    }
}

// GraphQL merges repeated response keys, including selections contributed by
// different fragments and records that finish in different hydration rounds.
fn merge_response(target: &mut Json, value: Json) {
    match (target, value) {
        (Json::Object(target), Json::Object(values)) => {
            for (key, value) in values {
                merge_response(target.entry(key).or_insert(Json::Null), value);
            }
        }
        (Json::Array(target), Json::Array(values)) if target.len() == values.len() => {
            for (target, value) in target.iter_mut().zip(values) {
                merge_response(target, value);
            }
        }
        (target, value) => *target = value,
    }
}

fn collect_fields<'a>(
    schema: &crate::meta::Schema,
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
                ..
            } => {
                let applies = match type_condition {
                    None => true,
                    Some(cond) => schema.type_matches(concrete_type, cond),
                };
                if applies {
                    collect_fields(schema, selection_set, concrete_type, out);
                }
            }
        }
    }
}

#[cfg(test)]
mod test;
