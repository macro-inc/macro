//! Typed-query cache inspection primitives.
//!
//! Inspection discovers argument-qualified instances of one selected field
//! without exposing normalized entity or field keys to host callers.

use crate::document::{ArgValue, FieldNode, Operation, OperationKind, Selection, resolve_args_key};
use crate::meta::{self, FieldKind};
use crate::query_path::{
    possible_selected_fields, selected_field, selected_storage_key, selected_type,
};
use crate::value::{CacheValue, EntityKey, Record, canonical_json};
use serde::Serialize;
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use thiserror::Error;

#[cfg(test)]
mod test;

/// Maximum field-only path depth accepted by query inspection.
pub const MAX_INSPECTION_PATH_DEPTH: usize = 16;
/// Maximum cached argument variants returned by one inspection.
pub const MAX_INSPECTED_VARIANTS: usize = 128;

/// A generated query and selected response-key path to inspect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryInspection {
    /// Serialized GraphQL operation document.
    pub query: String,
    /// Selected operation for multi-operation documents.
    pub operation_name: Option<String>,
    /// Field-only response-key path beginning at the query root.
    pub path: Vec<String>,
}

/// One cached argument variant reconstructed as generated query variables.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedQueryInstance {
    /// Variables recovered from the selected field's normalized arguments.
    pub variables: serde_json::Map<String, Json>,
    /// Selected value in the effective cache view. Absent on a query miss.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Json>,
}

/// Validation or traversal failure for query inspection.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum QueryInspectionError {
    /// The selected operation is not a query.
    #[error("query inspection entrypoint must be a query")]
    NotQuery,
    /// The path is empty or exceeds the defensive limit.
    #[error("invalid query inspection path depth {0}")]
    InvalidDepth(usize),
    /// A response key is not selected at the current schema type.
    #[error("query does not select `{field}` on `{type_name}`")]
    UnselectedField { type_name: String, field: String },
    /// More than one selected field can supply a response key.
    #[error("query inspection path `{field}` is ambiguous on `{type_name}`")]
    AmbiguousField { type_name: String, field: String },
    /// A prefix path field depends on operation variables.
    #[error("query inspection prefix field `{0}` contains an unbound variable")]
    VariablePrefix(String),
    /// An operation variable cannot be recovered from the final field.
    #[error("operation variable `{0}` cannot be recovered from the inspected field")]
    UnrecoverableVariable(String),
    /// The final selected field is not an object-valued field.
    #[error("query inspection final field must select an object value")]
    NonCompositeFinalField,
    /// A path field cannot be traversed as an object.
    #[error("query inspection path encountered an incompatible cache value")]
    WrongShape,
    /// The selected field owner has too many cached argument variants.
    #[error("query inspection variant count {actual} exceeds limit {maximum}")]
    TooManyVariants { actual: usize, maximum: usize },
    /// A complete query result unexpectedly lacks the validated path.
    #[error("complete query result does not contain the inspected path")]
    MissingResultPath,
}

/// Validated information needed to enumerate an inspection.
pub(crate) struct PreparedInspection {
    required_variables: BTreeSet<String>,
}

/// The effective owner record and final selected field.
pub(crate) struct InspectionOwner {
    pub fields: BTreeMap<String, CacheValue>,
    pub field: FieldNode,
}

/// Result of resolving the owner through currently loaded effective records.
pub(crate) enum OwnerResolution {
    Owner(InspectionOwner),
    NeedRecord(EntityKey),
    Absent,
}

/// Validates the query-rooted path and variable recoverability constraints.
pub(crate) fn prepare(
    operation: &Operation,
    path: &[String],
) -> Result<PreparedInspection, QueryInspectionError> {
    if operation.kind != OperationKind::Query {
        return Err(QueryInspectionError::NotQuery);
    }
    if path.is_empty() || path.len() > MAX_INSPECTION_PATH_DEPTH {
        return Err(QueryInspectionError::InvalidDepth(path.len()));
    }

    let mut selections = operation.selection_set.as_slice();
    let mut type_name = meta::QUERY_ROOT_TYPE;
    let mut final_variables = BTreeSet::new();
    for (index, response_key) in path.iter().enumerate() {
        let mut fields = Vec::new();
        possible_selected_fields(selections, type_name, response_key, &mut fields);
        let field = match fields.as_slice() {
            [] => {
                return Err(QueryInspectionError::UnselectedField {
                    type_name: type_name.to_string(),
                    field: response_key.clone(),
                });
            }
            [field] => *field,
            _ => {
                return Err(QueryInspectionError::AmbiguousField {
                    type_name: type_name.to_string(),
                    field: response_key.clone(),
                });
            }
        };

        let mut variables = BTreeSet::new();
        collect_field_variables(field, &mut variables);
        if index + 1 == path.len() {
            final_variables = variables;
        } else if !variables.is_empty() {
            return Err(QueryInspectionError::VariablePrefix(response_key.clone()));
        }

        let Some(metadata) = meta::field_meta(type_name, &field.name) else {
            return Err(QueryInspectionError::UnselectedField {
                type_name: type_name.to_string(),
                field: response_key.clone(),
            });
        };
        if metadata.ty.kind != FieldKind::Composite {
            return if index + 1 == path.len() {
                Err(QueryInspectionError::NonCompositeFinalField)
            } else {
                Err(QueryInspectionError::WrongShape)
            };
        }
        type_name = metadata.ty.name;
        selections = &field.selection_set;
    }

    let mut required_variables = BTreeSet::new();
    collect_selection_variables(&operation.selection_set, &mut required_variables);
    if let Some(variable) = required_variables
        .iter()
        .find(|variable| !final_variables.contains(*variable))
    {
        return Err(QueryInspectionError::UnrecoverableVariable(
            variable.clone(),
        ));
    }

    Ok(PreparedInspection { required_variables })
}

/// Resolves the record/object that owns the final selected field.
pub(crate) fn resolve_owner(
    records: &HashMap<EntityKey, Record>,
    operation: &Operation,
    path: &[String],
) -> Result<OwnerResolution, QueryInspectionError> {
    resolve_record_owner(
        records,
        &EntityKey::root(),
        meta::QUERY_ROOT_TYPE,
        &operation.selection_set,
        path,
    )
}

fn resolve_record_owner(
    records: &HashMap<EntityKey, Record>,
    key: &EntityKey,
    declared_type: &str,
    selections: &[Selection],
    path: &[String],
) -> Result<OwnerResolution, QueryInspectionError> {
    let Some(record) = records.get(key) else {
        return Ok(OwnerResolution::NeedRecord(key.clone()));
    };
    let concrete = record.typename().unwrap_or(declared_type);
    resolve_fields_owner(records, &record.fields, concrete, selections, path)
}

fn resolve_fields_owner(
    records: &HashMap<EntityKey, Record>,
    fields: &BTreeMap<String, CacheValue>,
    concrete: &str,
    selections: &[Selection],
    path: &[String],
) -> Result<OwnerResolution, QueryInspectionError> {
    let response_key = &path[0];
    let Some(field) = selected_field(selections, concrete, response_key) else {
        return Ok(OwnerResolution::Absent);
    };
    if path.len() == 1 {
        return Ok(OwnerResolution::Owner(InspectionOwner {
            fields: fields.clone(),
            field: field.clone(),
        }));
    }

    let storage_key = selected_storage_key(field, &serde_json::Map::new())
        .map_err(|_| QueryInspectionError::VariablePrefix(response_key.clone()))?;
    let Some(value) = fields.get(&storage_key) else {
        return Ok(OwnerResolution::Absent);
    };
    let next_type =
        selected_type(concrete, field).ok_or_else(|| QueryInspectionError::UnselectedField {
            type_name: concrete.to_string(),
            field: response_key.clone(),
        })?;
    match value {
        CacheValue::Ref(key) => {
            resolve_record_owner(records, key, next_type, &field.selection_set, &path[1..])
        }
        CacheValue::Object(object) => {
            let concrete = object
                .get("__typename")
                .and_then(|value| match value {
                    CacheValue::String(value) => Some(value.as_str()),
                    _ => None,
                })
                .unwrap_or(next_type);
            resolve_fields_owner(records, object, concrete, &field.selection_set, &path[1..])
        }
        CacheValue::Null => Ok(OwnerResolution::Absent),
        _ => Err(QueryInspectionError::WrongShape),
    }
}

/// Recovers and canonically deduplicates variables from matching owner fields.
pub(crate) fn recover_variants(
    owner: &InspectionOwner,
    prepared: &PreparedInspection,
) -> Result<Vec<serde_json::Map<String, Json>>, QueryInspectionError> {
    let mut matching = 0usize;
    let mut unique = BTreeMap::new();
    for storage_key in owner.fields.keys() {
        let Some(stored_arguments) = parse_stored_arguments(storage_key, &owner.field.name) else {
            continue;
        };
        matching += 1;
        if matching > MAX_INSPECTED_VARIANTS {
            return Err(QueryInspectionError::TooManyVariants {
                actual: matching,
                maximum: MAX_INSPECTED_VARIANTS,
            });
        }
        let Some(variables) = invert_arguments(&owner.field, &stored_arguments) else {
            continue;
        };
        if prepared
            .required_variables
            .iter()
            .any(|variable| !variables.contains_key(variable))
        {
            continue;
        }
        let key = canonical_json(&Json::Object(variables.clone()));
        unique.entry(key).or_insert(variables);
    }
    Ok(unique.into_values().collect())
}

fn parse_stored_arguments(
    storage_key: &str,
    field_name: &str,
) -> Option<serde_json::Map<String, Json>> {
    if storage_key == field_name {
        return Some(serde_json::Map::new());
    }
    let encoded = storage_key
        .strip_prefix(field_name)?
        .strip_prefix('(')?
        .strip_suffix(')')?;
    let Json::Object(arguments) = serde_json::from_str(encoded).ok()? else {
        return None;
    };
    Some(arguments)
}

fn invert_arguments(
    field: &FieldNode,
    stored: &serde_json::Map<String, Json>,
) -> Option<serde_json::Map<String, Json>> {
    if stored.len() != field.arguments.len() {
        return None;
    }
    let mut variables = serde_json::Map::new();
    for (name, expression) in &field.arguments {
        bind_expression(expression, stored.get(name)?, &mut variables)?;
    }
    let resolved = resolve_args_key(field, &variables).ok()?;
    let resolved = resolved
        .as_deref()
        .map(|arguments| format!("{}({arguments})", field.name))
        .unwrap_or_else(|| field.name.clone());
    let stored_key = if stored.is_empty() {
        field.name.clone()
    } else {
        format!(
            "{}({})",
            field.name,
            canonical_json(&Json::Object(stored.clone()))
        )
    };
    (resolved == stored_key).then_some(variables)
}

fn bind_expression(
    expression: &ArgValue,
    stored: &Json,
    variables: &mut serde_json::Map<String, Json>,
) -> Option<()> {
    match expression {
        ArgValue::Const(expected) => (expected == stored).then_some(()),
        ArgValue::Variable(name) => match variables.get(name) {
            Some(bound) => (bound == stored).then_some(()),
            None => {
                variables.insert(name.clone(), stored.clone());
                Some(())
            }
        },
        ArgValue::List(expressions) => {
            let Json::Array(stored) = stored else {
                return None;
            };
            if expressions.len() != stored.len() {
                return None;
            }
            for (expression, stored) in expressions.iter().zip(stored) {
                bind_expression(expression, stored, variables)?;
            }
            Some(())
        }
        ArgValue::Object(expressions) => {
            let Json::Object(stored) = stored else {
                return None;
            };
            if expressions.len() != stored.len() {
                return None;
            }
            for (name, expression) in expressions {
                bind_expression(expression, stored.get(name)?, variables)?;
            }
            Some(())
        }
    }
}

fn collect_selection_variables(selections: &[Selection], out: &mut BTreeSet<String>) {
    for selection in selections {
        match selection {
            Selection::Field(field) => {
                collect_field_variables(field, out);
                collect_selection_variables(&field.selection_set, out);
            }
            Selection::Fragment { selection_set, .. } => {
                collect_selection_variables(selection_set, out);
            }
        }
    }
}

fn collect_field_variables(field: &FieldNode, out: &mut BTreeSet<String>) {
    for (_, value) in &field.arguments {
        collect_arg_variables(value, out);
    }
}

fn collect_arg_variables(value: &ArgValue, out: &mut BTreeSet<String>) {
    match value {
        ArgValue::Variable(name) => {
            out.insert(name.clone());
        }
        ArgValue::List(values) => {
            for value in values {
                collect_arg_variables(value, out);
            }
        }
        ArgValue::Object(fields) => {
            for (_, value) in fields {
                collect_arg_variables(value, out);
            }
        }
        ArgValue::Const(_) => {}
    }
}

/// Extracts the selected value from one complete denormalized query result.
pub(crate) fn selected_result_value(
    data: &Json,
    path: &[String],
) -> Result<Json, QueryInspectionError> {
    let mut current = data;
    for field in path {
        let Json::Object(object) = current else {
            return Err(QueryInspectionError::MissingResultPath);
        };
        current = object
            .get(field)
            .ok_or(QueryInspectionError::MissingResultPath)?;
    }
    Ok(current.clone())
}
