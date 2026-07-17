//! Fragment-rooted selection over normalized cache records.
//!
//! A selection is a named GraphQL fragment whose type condition resolves
//! only to normalized entity objects. Records are returned in stable entity
//! key order and projected with the ordinary denormalizer.

use crate::document::{ArgValue, Document, DocumentError, FieldNode, Selection};
use crate::meta::{self, FieldKind, TypeKind};
use crate::value::EntityKey;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};
use serde_json::Value as Json;
use std::collections::BTreeSet;
use thiserror::Error;

/// Largest record-selection page accepted by the engine.
pub const MAX_RECORD_SELECTION_PAGE_SIZE: usize = 500;

/// A validated named fragment that can be applied to normalized records.
#[derive(Debug, Clone)]
pub struct RecordSelection {
    type_names: Vec<String>,
    selection_set: Vec<Selection>,
}

impl RecordSelection {
    /// Parses and validates a named fragment document.
    pub fn parse(document: &str, fragment_name: &str) -> Result<Self, RecordSelectionError> {
        let document = Document::parse(document)?;
        for fragment in &document.fragments {
            concrete_type_names(&fragment.type_condition)?;
            validate_selections(&fragment.selection_set, &fragment.type_condition)?;
        }
        let fragment = document.fragment(fragment_name)?;
        let type_names = concrete_type_names(&fragment.type_condition)?;
        if type_names.is_empty() {
            return Err(RecordSelectionError::NoConcreteTypes(
                fragment.type_condition.clone(),
            ));
        }
        for type_name in &type_names {
            let metadata = meta::type_meta(type_name)
                .ok_or_else(|| RecordSelectionError::UnknownType(type_name.clone()))?;
            if metadata.kind != TypeKind::Object || metadata.key_fields.is_none() {
                return Err(RecordSelectionError::NotNormalized(type_name.clone()));
            }
        }
        Ok(Self {
            type_names,
            selection_set: fragment.selection_set.clone(),
        })
    }

    /// Concrete normalized object type names selected by this fragment.
    pub fn type_names(&self) -> &[String] {
        &self.type_names
    }

    pub(crate) fn selection_set(&self) -> &[Selection] {
        &self.selection_set
    }
}

/// Opaque exclusive cursor into entity-key record ordering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordCursor(EntityKey);

impl RecordCursor {
    pub(crate) fn new(entity_key: EntityKey) -> Self {
        Self(entity_key)
    }

    pub(crate) fn entity_key(&self) -> &EntityKey {
        &self.0
    }
}

impl Serialize for RecordCursor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&encode_cursor(&self.0))
    }
}

impl<'de> Deserialize<'de> for RecordCursor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        decode_cursor(&value).map(Self).map_err(D::Error::custom)
    }
}

/// One page of projected normalized records.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedRecordPage {
    /// Complete fragment projections in deterministic entity-key order.
    pub records: Vec<Json>,
    /// Exclusive cursor for the next page, present only when another complete
    /// matching record exists.
    pub next_cursor: Option<RecordCursor>,
}

/// Invalid fragment selection, cursor, or page request.
#[derive(Debug, Error)]
pub enum RecordSelectionError {
    /// The GraphQL document is malformed or the requested fragment is absent.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// A type condition references a type not in the compiled schema.
    #[error("unknown schema type `{0}`")]
    UnknownType(String),
    /// An abstract type has no concrete object implementations.
    #[error("type condition `{0}` has no concrete object types")]
    NoConcreteTypes(String),
    /// A selected concrete object is embedded rather than independently keyed.
    #[error("type condition resolves to non-normalized type `{0}`")]
    NotNormalized(String),
    /// A selected field does not exist on its containing schema type.
    #[error("unknown field `{type_name}.{field}`")]
    UnknownField { type_name: String, field: String },
    /// A nested fragment can never apply within its containing type.
    #[error("type condition `{condition}` cannot apply within `{parent}`")]
    ImpossibleTypeCondition { condition: String, parent: String },
    /// Fragment record reads have no variable bindings.
    #[error("record-selection fragment references unbound variable `${0}`")]
    UnboundVariable(String),
    /// A leaf field has sub-selections or a composite field has none.
    #[error("field `{type_name}.{field}` has an invalid selection shape")]
    InvalidFieldShape { type_name: String, field: String },
    /// Page limits must be nonzero and no larger than the safety bound.
    #[error("record-selection limit must be between 1 and {max}, got {limit}")]
    InvalidLimit { limit: usize, max: usize },
}

/// Validates a requested page size.
pub fn validate_limit(limit: usize) -> Result<(), RecordSelectionError> {
    if !(1..=MAX_RECORD_SELECTION_PAGE_SIZE).contains(&limit) {
        return Err(RecordSelectionError::InvalidLimit {
            limit,
            max: MAX_RECORD_SELECTION_PAGE_SIZE,
        });
    }
    Ok(())
}

fn concrete_type_names(type_name: &str) -> Result<Vec<String>, RecordSelectionError> {
    let metadata = meta::type_meta(type_name)
        .ok_or_else(|| RecordSelectionError::UnknownType(type_name.to_string()))?;
    let mut names = match metadata.kind {
        TypeKind::Object => vec![type_name.to_string()],
        TypeKind::Interface | TypeKind::Union => metadata
            .possible_types
            .iter()
            .map(|name| (*name).to_string())
            .collect(),
    };
    names.sort();
    names.dedup();
    Ok(names)
}

fn validate_selections(
    selections: &[Selection],
    parent_type: &str,
) -> Result<(), RecordSelectionError> {
    for selection in selections {
        match selection {
            Selection::Field(field) => validate_field(field, parent_type)?,
            Selection::Fragment {
                type_condition,
                selection_set,
            } => match type_condition {
                None => validate_selections(selection_set, parent_type)?,
                Some(condition) => {
                    let parent_types: BTreeSet<_> =
                        concrete_type_names(parent_type)?.into_iter().collect();
                    let condition_types = concrete_type_names(condition)?;
                    if !condition_types
                        .iter()
                        .any(|type_name| parent_types.contains(type_name))
                    {
                        return Err(RecordSelectionError::ImpossibleTypeCondition {
                            condition: condition.clone(),
                            parent: parent_type.to_string(),
                        });
                    }
                    validate_selections(selection_set, condition)?;
                }
            },
        }
    }
    Ok(())
}

fn validate_field(field: &FieldNode, parent_type: &str) -> Result<(), RecordSelectionError> {
    for (_, value) in &field.arguments {
        if let Some(variable) = referenced_variable(value) {
            return Err(RecordSelectionError::UnboundVariable(variable.to_string()));
        }
    }
    if field.name == "__typename" {
        if field.selection_set.is_empty() {
            return Ok(());
        }
        return Err(RecordSelectionError::InvalidFieldShape {
            type_name: parent_type.to_string(),
            field: field.name.clone(),
        });
    }

    let metadata = meta::field_meta(parent_type, &field.name).ok_or_else(|| {
        RecordSelectionError::UnknownField {
            type_name: parent_type.to_string(),
            field: field.name.clone(),
        }
    })?;
    match metadata.ty.kind {
        FieldKind::Composite if field.selection_set.is_empty() => {
            Err(RecordSelectionError::InvalidFieldShape {
                type_name: parent_type.to_string(),
                field: field.name.clone(),
            })
        }
        FieldKind::Composite => validate_selections(&field.selection_set, metadata.ty.name),
        FieldKind::Leaf | FieldKind::OpaqueScalar if !field.selection_set.is_empty() => {
            Err(RecordSelectionError::InvalidFieldShape {
                type_name: parent_type.to_string(),
                field: field.name.clone(),
            })
        }
        FieldKind::Leaf | FieldKind::OpaqueScalar => Ok(()),
    }
}

fn referenced_variable(value: &ArgValue) -> Option<&str> {
    match value {
        ArgValue::Variable(name) => Some(name),
        ArgValue::List(items) => items.iter().find_map(referenced_variable),
        ArgValue::Object(fields) => fields
            .iter()
            .find_map(|(_, value)| referenced_variable(value)),
        ArgValue::Const(_) => None,
    }
}

fn encode_cursor(entity_key: &EntityKey) -> String {
    let encoded: String = entity_key
        .0
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("r1.{encoded}")
}

fn decode_cursor(value: &str) -> Result<EntityKey, &'static str> {
    let encoded = value
        .strip_prefix("r1.")
        .ok_or("invalid record-selection cursor")?;
    if encoded.is_empty() || !encoded.len().is_multiple_of(2) {
        return Err("invalid record-selection cursor");
    }
    let bytes = encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).map_err(|_| "invalid record-selection cursor")?;
            u8::from_str_radix(pair, 16).map_err(|_| "invalid record-selection cursor")
        })
        .collect::<Result<Vec<_>, _>>()?;
    String::from_utf8(bytes)
        .map(EntityKey)
        .map_err(|_| "invalid record-selection cursor")
}

#[cfg(test)]
mod test;
