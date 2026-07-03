//! Write path: response JSON → normalized records.

use crate::document::{resolve_args_key, FieldNode, MissingVariable, Operation, Selection};
use crate::meta::{self, FieldKind, TypeKind};
use crate::value::{field_key, CacheValue, EntityKey, Record};
use serde_json::Value as Json;
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NormalizeError {
    #[error(transparent)]
    MissingVariable(#[from] MissingVariable),
    #[error("unknown type `{0}` (schema drift? rebuild after schema changes)")]
    UnknownType(String),
    #[error("unknown field `{type_name}.{field}`")]
    UnknownField { type_name: String, field: String },
    #[error("`{type_name}` is abstract but the response object has no __typename; add __typename to the selection")]
    MissingTypename { type_name: String },
    #[error("key field `{type_name}.{field}` is missing or not a string/number in the response; every query fetching `{type_name}` must select its key")]
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
pub type RecordUpdates = BTreeMap<EntityKey, Record>;

/// Normalizes a response's `data` object into record updates rooted at
/// [`ROOT_QUERY`](crate::value::ROOT_QUERY).
pub fn normalize(
    op: &Operation,
    variables: &serde_json::Map<String, Json>,
    data: &Json,
) -> Result<RecordUpdates, NormalizeError> {
    let Json::Object(data) = data else {
        return Err(NormalizeError::Shape {
            type_name: meta::QUERY_ROOT_TYPE.to_string(),
            field: "(data)".to_string(),
            detail: "response data is not an object",
        });
    };
    let mut records = RecordUpdates::new();
    let mut root = Record::default();
    write_object_fields(
        &op.selection_set,
        meta::QUERY_ROOT_TYPE,
        data,
        variables,
        &mut root.fields,
        &mut records,
    )?;
    merge_into(&mut records, EntityKey::root(), root);
    Ok(records)
}

fn merge_into(records: &mut RecordUpdates, key: EntityKey, record: Record) {
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
    variables: &serde_json::Map<String, Json>,
    target: &mut BTreeMap<String, CacheValue>,
    records: &mut RecordUpdates,
) -> Result<(), NormalizeError> {
    // The concrete type: trust __typename in the response when present.
    let concrete = match data.get("__typename") {
        Some(Json::String(t)) => t.as_str(),
        _ => type_name,
    };
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
        let args = resolve_args_key(f, variables)?;
        let storage_key = field_key(&f.name, args.as_deref());

        // GraphQL guarantees selected fields are present in data; tolerate
        // absence by skipping (defensive against non-conformant servers).
        let Some(value) = data.get(&f.response_key) else {
            continue;
        };

        let cache_value = write_value(f, fmeta.ty.name, fmeta.ty.kind, value, variables, records)
            .map_err(|detail| NormalizeError::Shape {
            type_name: concrete.to_string(),
            field: f.name.clone(),
            detail,
        })?;
        let cache_value = cache_value?;
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
    variables: &serde_json::Map<String, Json>,
    records: &mut RecordUpdates,
) -> Result<Result<CacheValue, NormalizeError>, &'static str> {
    Ok(match value {
        Json::Null => Ok(CacheValue::Null),
        Json::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                match write_value(field, named_type, kind, item, variables, records)? {
                    Ok(v) => out.push(v),
                    Err(e) => return Ok(Err(e)),
                }
            }
            Ok(CacheValue::List(out))
        }
        Json::Bool(b) => match kind {
            FieldKind::Leaf => Ok(CacheValue::Bool(*b)),
            FieldKind::OpaqueScalar => Ok(CacheValue::Opaque(value.clone())),
            FieldKind::Composite => return Err("expected object, got boolean"),
        },
        Json::Number(n) => match kind {
            FieldKind::Leaf => Ok(CacheValue::Number(n.clone())),
            FieldKind::OpaqueScalar => Ok(CacheValue::Opaque(value.clone())),
            FieldKind::Composite => return Err("expected object, got number"),
        },
        Json::String(s) => match kind {
            FieldKind::Leaf => Ok(CacheValue::String(s.clone())),
            FieldKind::OpaqueScalar => Ok(CacheValue::Opaque(value.clone())),
            FieldKind::Composite => return Err("expected object, got string"),
        },
        Json::Object(obj) => match kind {
            FieldKind::OpaqueScalar => Ok(CacheValue::Opaque(value.clone())),
            FieldKind::Leaf => return Err("expected scalar, got object"),
            FieldKind::Composite => {
                match normalize_object(field, named_type, obj, variables, records) {
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
    variables: &serde_json::Map<String, Json>,
    records: &mut RecordUpdates,
) -> Result<CacheValue, NormalizeError> {
    let named_meta = meta::type_meta(named_type)
        .ok_or_else(|| NormalizeError::UnknownType(named_type.to_string()))?;

    let concrete: &str = match obj.get("__typename") {
        Some(Json::String(t)) => t,
        _ if named_meta.kind == TypeKind::Object => named_type,
        _ => {
            return Err(NormalizeError::MissingTypename {
                type_name: named_type.to_string(),
            })
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
                        })
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
                variables,
                &mut record.fields,
                records,
            )?;
            merge_into(records, key.clone(), record);
            Ok(CacheValue::Ref(key))
        }
        None => {
            let mut embedded = BTreeMap::new();
            write_object_fields(
                &field.selection_set,
                concrete,
                obj,
                variables,
                &mut embedded,
                records,
            )?;
            Ok(CacheValue::Object(embedded))
        }
    }
}
