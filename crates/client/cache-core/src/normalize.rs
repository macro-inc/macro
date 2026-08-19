//! Write path: response JSON → normalized records.

use crate::document::{
    FieldNode, MissingVariable, Operation, OperationKind, Selection, resolve_args, resolve_args_key,
};
use crate::entity_resolver::EntityResolverLookup;
use crate::meta::{self, FieldKind, TypeKind};
use crate::value::{CacheValue, EntityKey, Record, field_key};
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NormalizeError {
    #[error(transparent)]
    MissingVariable(#[from] MissingVariable),
    #[error("unknown type `{0}` (schema drift? rebuild after schema changes)")]
    UnknownType(String),
    #[error("unknown field `{type_name}.{field}`")]
    UnknownField { type_name: String, field: String },
    #[error(
        "`{type_name}` is abstract but the response object has no __typename; add __typename to the selection"
    )]
    MissingTypename { type_name: String },
    #[error(
        "key field `{type_name}.{field}` is missing or not a string/number in the response; every query fetching `{type_name}` must select its key"
    )]
    BadKeyField { type_name: String, field: String },
    #[error("response field `{type_name}.{field}` has unexpected shape: {detail}")]
    Shape {
        type_name: String,
        field: String,
        detail: &'static str,
    },
}

/// Records produced by normalizing one response. Each record contains only
/// the fields this response provided — the store merges them into existing
/// records.
pub type RecordUpdates = BTreeMap<EntityKey<'static>, Record>;

/// Whether response-derived dependencies exactly describe a future cache read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DependencyCompleteness {
    Exact,
    Broad,
}

/// Normalized updates and dependencies captured without reading records back.
pub(crate) struct NormalizeResult {
    pub updates: RecordUpdates,
    pub dependencies: BTreeSet<EntityKey<'static>>,
    pub completeness: DependencyCompleteness,
}

struct DependencyCapture<'a> {
    keys: BTreeSet<EntityKey<'static>>,
    completeness: DependencyCompleteness,
    entity_resolvers: &'a EntityResolverLookup,
}

impl DependencyCapture<'_> {
    fn mark_broad(&mut self) {
        self.completeness = DependencyCompleteness::Broad;
    }
}

struct WriteContext<'a, 'resolver> {
    variables: &'a serde_json::Map<String, Json>,
    records: &'a mut RecordUpdates,
    dependencies: &'a mut DependencyCapture<'resolver>,
}

/// Normalizes a response's `data` object into record updates.
///
/// Query responses are rooted at [`ROOT_QUERY`](crate::value::ROOT_QUERY).
/// Mutation and subscription responses traverse from their schema roots:
/// nested entities are normalized as usual, but operation-root fields are
/// discarded. Those roots are transient cache entry points, never read back.
pub fn normalize(
    op: &Operation,
    variables: &serde_json::Map<String, Json>,
    data: &Json,
) -> Result<RecordUpdates, NormalizeError> {
    Ok(normalize_with_dependencies(op, variables, data, &EntityResolverLookup::default())?.updates)
}

/// Normalizes a response and captures the records a cache read would depend on.
pub(crate) fn normalize_with_dependencies(
    op: &Operation,
    variables: &serde_json::Map<String, Json>,
    data: &Json,
    entity_resolvers: &EntityResolverLookup,
) -> Result<NormalizeResult, NormalizeError> {
    let root_type = operation_root_type(op)?;
    let Json::Object(data) = data else {
        return Err(NormalizeError::Shape {
            type_name: root_type.to_string(),
            field: "(data)".to_string(),
            detail: "response data is not an object",
        });
    };
    let mut records = RecordUpdates::new();
    let mut root = Record::default();
    let mut dependencies = DependencyCapture {
        keys: BTreeSet::new(),
        completeness: DependencyCompleteness::Exact,
        entity_resolvers,
    };
    let root_key = (op.kind == OperationKind::Query).then(EntityKey::root);
    write_object_fields(
        &op.selection_set,
        root_type,
        data,
        &mut root.fields,
        root_key.as_ref(),
        &mut WriteContext {
            variables,
            records: &mut records,
            dependencies: &mut dependencies,
        },
    )?;
    if let Some(root_key) = root_key {
        merge_into(&mut records, root_key, root);
    }
    Ok(NormalizeResult {
        updates: records,
        dependencies: dependencies.keys,
        completeness: dependencies.completeness,
    })
}

/// Projects fields not marked `@cacheOnly` directly from a network response.
/// Cache-only branches are not traversed or cloned.
pub fn project_hydration_response(
    op: &Operation,
    data: &Json,
) -> Result<Option<Json>, NormalizeError> {
    let root_type = operation_root_type(op)?;
    let Json::Object(data) = data else {
        return Err(NormalizeError::Shape {
            type_name: root_type.to_string(),
            field: "(data)".to_string(),
            detail: "response data is not an object",
        });
    };
    Ok(project_object_fields(&op.selection_set, root_type, data)?.map(Json::Object))
}

fn operation_root_type(op: &Operation) -> Result<&'static str, NormalizeError> {
    match op.kind {
        OperationKind::Query => Ok(meta::QUERY_ROOT_TYPE),
        OperationKind::Mutation => meta::MUTATION_ROOT_TYPE
            .ok_or_else(|| NormalizeError::UnknownType("(mutation root)".to_string())),
        OperationKind::Subscription => meta::SUBSCRIPTION_ROOT_TYPE
            .ok_or_else(|| NormalizeError::UnknownType("(subscription root)".to_string())),
    }
}

fn project_object_fields(
    selections: &[Selection],
    type_name: &str,
    data: &serde_json::Map<String, Json>,
) -> Result<Option<serde_json::Map<String, Json>>, NormalizeError> {
    let concrete = match data.get("__typename") {
        Some(Json::String(name)) => name.as_str(),
        _ => type_name,
    };
    let mut fields = Vec::new();
    collect_fields(selections, concrete, &mut fields);
    let mut projected = serde_json::Map::new();
    for field in fields {
        if field.cache_only {
            continue;
        }
        let Some(value) = data.get(&field.response_key) else {
            continue;
        };
        if field.name == "__typename" {
            projected.insert(field.response_key.clone(), value.clone());
            continue;
        }
        let field_meta = meta::field_meta(concrete, &field.name).ok_or_else(|| {
            NormalizeError::UnknownField {
                type_name: concrete.to_string(),
                field: field.name.clone(),
            }
        })?;
        if let Some(value) = project_value(field, field_meta.ty.name, field_meta.ty.kind, value)? {
            projected.insert(field.response_key.clone(), value);
        }
    }
    Ok((!projected.is_empty()).then_some(projected))
}

fn project_value(
    field: &FieldNode,
    named_type: &str,
    kind: FieldKind,
    value: &Json,
) -> Result<Option<Json>, NormalizeError> {
    match (kind, value) {
        (FieldKind::Composite, Json::Object(object)) => {
            Ok(project_object_fields(&field.selection_set, named_type, object)?.map(Json::Object))
        }
        (FieldKind::Composite, Json::Array(items)) => {
            if !field.selection_set.iter().any(selection_returns_data) {
                return Ok(None);
            }
            let mut projected = Vec::with_capacity(items.len());
            for item in items {
                let item = match item {
                    Json::Null => Json::Null,
                    Json::Object(object) => {
                        project_object_fields(&field.selection_set, named_type, object)?
                            .map_or_else(|| Json::Object(serde_json::Map::new()), Json::Object)
                    }
                    _ => {
                        return Err(NormalizeError::Shape {
                            type_name: named_type.to_string(),
                            field: field.name.clone(),
                            detail: "expected object list",
                        });
                    }
                };
                projected.push(item);
            }
            Ok(Some(Json::Array(projected)))
        }
        (FieldKind::Composite, Json::Null) => {
            let has_projected_selection = field.selection_set.iter().any(selection_returns_data);
            Ok(has_projected_selection.then_some(Json::Null))
        }
        (FieldKind::Composite, _) => Err(NormalizeError::Shape {
            type_name: named_type.to_string(),
            field: field.name.clone(),
            detail: "expected object",
        }),
        (_, value) => Ok(Some(value.clone())),
    }
}

fn selection_returns_data(selection: &Selection) -> bool {
    match selection {
        Selection::Field(field) => !field.cache_only,
        Selection::Fragment { selection_set, .. } => {
            selection_set.iter().any(selection_returns_data)
        }
    }
}

fn merge_into(records: &mut RecordUpdates, key: EntityKey<'static>, record: Record) {
    records.entry(key).or_default().merge(record);
}

/// Flattens fragments applicable to `concrete_type` and visits each field.
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

/// Writes the selected fields of one response object into `target` (a
/// record's or embedded object's field map), normalizing children into
/// `records`.
fn write_object_fields(
    selections: &[Selection],
    type_name: &str,
    data: &serde_json::Map<String, Json>,
    target: &mut BTreeMap<String, CacheValue>,
    owner: Option<&EntityKey<'static>>,
    context: &mut WriteContext<'_, '_>,
) -> Result<(), NormalizeError> {
    // The concrete type: trust __typename in the response when present.
    let concrete = match data.get("__typename") {
        Some(Json::String(t)) => t.as_str(),
        _ => type_name,
    };
    if let Some(owner) = owner {
        context.dependencies.keys.insert(owner.clone());
    }
    target.insert(
        "__typename".to_string(),
        CacheValue::String(concrete.to_string()),
    );

    let mut fields = Vec::new();
    collect_fields(selections, concrete, &mut fields);

    for f in fields {
        if f.name == "__typename" {
            continue; // handled above
        }
        let fmeta =
            meta::field_meta(concrete, &f.name).ok_or_else(|| NormalizeError::UnknownField {
                type_name: concrete.to_string(),
                field: f.name.clone(),
            })?;
        let args = resolve_args_key(f, context.variables)?;
        let storage_key = field_key(&f.name, args.as_deref());

        // GraphQL guarantees selected fields are present in data. Missing
        // fields are still tolerated, but an exact dependency set cannot be
        // proven because a merged record may retain an older relation.
        let Some(value) = data.get(&f.response_key) else {
            context.dependencies.mark_broad();
            continue;
        };

        let cache_value = write_value(f, fmeta.ty.name, fmeta.ty.kind, value, owner, context)
            .map_err(|detail| NormalizeError::Shape {
                type_name: concrete.to_string(),
                field: f.name.clone(),
                detail,
            })??;

        if let Some(resolver) = context.dependencies.entity_resolvers.get(concrete, &f.name) {
            let expected_key = resolve_args(f, context.variables)
                .ok()
                .and_then(|arguments| resolver.entity_key(&arguments));
            match (expected_key, value, &cache_value) {
                (Some(expected), Json::Object(_), CacheValue::Ref(actual))
                    if expected == *actual =>
                {
                    context.dependencies.keys.insert(expected);
                }
                _ => context.dependencies.mark_broad(),
            }
        }
        target.insert(storage_key, cache_value);
    }
    Ok(())
}

/// Converts one response value. Outer `Result` is shape errors (with static
/// detail); inner carries nested structured errors.
#[allow(clippy::type_complexity)]
fn write_value(
    field: &FieldNode,
    named_type: &str,
    kind: FieldKind,
    value: &Json,
    owner: Option<&EntityKey<'static>>,
    context: &mut WriteContext<'_, '_>,
) -> Result<Result<CacheValue, NormalizeError>, &'static str> {
    Ok(match value {
        Json::Null => Ok(CacheValue::Null),
        Json::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                match write_value(field, named_type, kind, item, owner, context)? {
                    Ok(v) => out.push(v),
                    Err(e) => return Ok(Err(e)),
                }
            }
            Ok(CacheValue::List(out))
        }
        Json::Bool(b) => match kind {
            FieldKind::Leaf => Ok(CacheValue::Bool(*b)),
            FieldKind::OpaqueScalar => Ok(CacheValue::opaque(value)),
            FieldKind::Composite => return Err("expected object, got boolean"),
        },
        Json::Number(n) => match kind {
            FieldKind::Leaf => Ok(CacheValue::Number(n.into())),
            FieldKind::OpaqueScalar => Ok(CacheValue::opaque(value)),
            FieldKind::Composite => return Err("expected object, got number"),
        },
        Json::String(s) => match kind {
            FieldKind::Leaf => Ok(CacheValue::String(s.clone())),
            FieldKind::OpaqueScalar => Ok(CacheValue::opaque(value)),
            FieldKind::Composite => return Err("expected object, got string"),
        },
        Json::Object(obj) => match kind {
            FieldKind::OpaqueScalar => Ok(CacheValue::opaque(value)),
            FieldKind::Leaf => return Err("expected scalar, got object"),
            FieldKind::Composite => {
                match normalize_object(field, named_type, obj, owner, context) {
                    Ok(v) => Ok(v),
                    Err(e) => return Ok(Err(e)),
                }
            }
        },
    })
}

/// Normalizes a composite response object: either into its own record
/// (keyable → `Ref`) or an embedded object value.
fn normalize_object(
    field: &FieldNode,
    named_type: &str,
    obj: &serde_json::Map<String, Json>,
    owner: Option<&EntityKey<'static>>,
    context: &mut WriteContext<'_, '_>,
) -> Result<CacheValue, NormalizeError> {
    let named_meta = meta::type_meta(named_type)
        .ok_or_else(|| NormalizeError::UnknownType(named_type.to_string()))?;

    let concrete: &str = match obj.get("__typename") {
        Some(Json::String(t)) => t,
        _ if named_meta.kind == TypeKind::Object => named_type,
        _ => {
            return Err(NormalizeError::MissingTypename {
                type_name: named_type.to_string(),
            });
        }
    };
    let concrete_meta = meta::type_meta(concrete)
        .ok_or_else(|| NormalizeError::UnknownType(concrete.to_string()))?;

    match concrete_meta.key_fields {
        Some(key_fields) => {
            let mut key_values = Vec::with_capacity(key_fields.len());
            for kf in key_fields {
                let v = match obj.get(*kf) {
                    Some(Json::String(s)) => s.clone(),
                    Some(Json::Number(n)) => n.to_string(),
                    _ => {
                        return Err(NormalizeError::BadKeyField {
                            type_name: concrete.to_string(),
                            field: kf.to_string(),
                        });
                    }
                };
                key_values.push(v);
            }
            let key = EntityKey::entity(
                concrete,
                &key_values.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            );
            let mut record = Record::default();
            write_object_fields(
                &field.selection_set,
                concrete,
                obj,
                &mut record.fields,
                Some(&key),
                context,
            )?;
            merge_into(context.records, key.clone(), record);
            Ok(CacheValue::Ref(key))
        }
        None => {
            let mut embedded = BTreeMap::new();
            write_object_fields(
                &field.selection_set,
                concrete,
                obj,
                &mut embedded,
                owner,
                context,
            )?;
            Ok(CacheValue::Object(embedded))
        }
    }
}
