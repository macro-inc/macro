//! Shared GraphQL response-path helpers used by query-rooted cache APIs.

use crate::document::{FieldNode, MissingVariable, Selection, resolve_args_key};
use crate::value::{FieldKey, field_key};
use serde_json::Value as Json;

/// Finds the first field selected under `response_key` for a concrete type.
///
/// GraphQL response-key merging is deliberately left to each caller: link
/// patches retain their existing first-match behavior, while inspection
/// performs a separate ambiguity check before traversal.
pub(crate) fn selected_field<'a>(
    schema: &crate::meta::Schema,
    selections: &'a [Selection],
    concrete: &str,
    response_key: &str,
) -> Option<&'a FieldNode> {
    for selection in selections {
        match selection {
            Selection::Field(field) if field.response_key == response_key => return Some(field),
            Selection::Field(_) => {}
            Selection::Fragment {
                type_condition,
                selection_set,
            } if type_condition
                .as_deref()
                .is_none_or(|condition| schema.type_matches(concrete, condition)) =>
            {
                if let Some(field) = selected_field(schema, selection_set, concrete, response_key) {
                    return Some(field);
                }
            }
            Selection::Fragment { .. } => {}
        }
    }
    None
}

/// Collects fields with a response key that can apply to `type_name`.
///
/// Unlike [`selected_field`], this treats abstract type overlaps as possible
/// so inspection can reject ambiguous paths before consulting cache data.
pub(crate) fn possible_selected_fields<'a>(
    schema: &crate::meta::Schema,
    selections: &'a [Selection],
    type_name: &str,
    response_key: &str,
    out: &mut Vec<&'a FieldNode>,
) {
    for selection in selections {
        match selection {
            Selection::Field(field) if field.response_key == response_key => out.push(field),
            Selection::Field(_) => {}
            Selection::Fragment {
                type_condition,
                selection_set,
            } if type_condition
                .as_deref()
                .is_none_or(|condition| types_overlap(schema, type_name, condition)) =>
            {
                possible_selected_fields(schema, selection_set, type_name, response_key, out);
            }
            Selection::Fragment { .. } => {}
        }
    }
}

fn types_overlap(schema: &crate::meta::Schema, left: &str, right: &str) -> bool {
    if left == right || schema.type_matches(left, right) || schema.type_matches(right, left) {
        return true;
    }
    let Some(left) = schema.type_meta(left) else {
        return false;
    };
    let Some(right) = schema.type_meta(right) else {
        return false;
    };
    left.possible_types
        .iter()
        .any(|possible| right.possible_types.contains(possible))
}

/// Resolves one selected field to its normalized storage key.
pub(crate) fn selected_storage_key(
    field: &FieldNode,
    variables: &serde_json::Map<String, Json>,
) -> Result<FieldKey, MissingVariable> {
    let arguments = resolve_args_key(field, variables)?;
    Ok(field_key(&field.name, arguments.as_deref()))
}

/// Returns the named schema type selected by `field` on `concrete`.
pub(crate) fn selected_type<'schema>(
    schema: &'schema crate::meta::Schema,
    concrete: &str,
    field: &FieldNode,
) -> Option<&'schema str> {
    schema
        .field_meta(concrete, &field.name)
        .map(|metadata| metadata.ty.name)
}
