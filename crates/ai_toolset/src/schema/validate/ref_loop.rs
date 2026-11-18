use schemars::Schema;
use serde_json::Value;
use std::collections::HashMap;

use crate::schema::error::ValidationError;

#[cfg(test)]
mod test;

/// Rejects a schema with a `$ref` loop that every valid value must keep
/// following, which Gemini refuses with 400 INVALID_ARGUMENT.
pub fn validate_no_required_ref_loop(schema: &Schema) -> Result<(), ValidationError> {
    match required_ref_loop(schema.as_value()) {
        Some(path) => Err(ValidationError::RequiredRefLoop(path)),
        None => Ok(()),
    }
}

/// Where a `$ref` loop of required fields closes, as a dotted path such as
/// `$defs.Filter.anyOf.2.properties.clause`, if the schema has one.
///
/// A loop is accepted when it passes through an optional or nullable
/// property, or through the items of an array that may be empty. Every
/// branch of `anyOf`, `oneOf` and `allOf` counts as required: Gemini rejects
/// a loop even when a sibling branch would end it.
pub fn required_ref_loop(root: &Value) -> Option<String> {
    let mut starts = vec![String::new()];
    for container in ["$defs", "definitions"] {
        if let Some(definitions) = root.get(container).and_then(Value::as_object) {
            starts.extend(definitions.keys().map(|name| {
                format!(
                    "/{container}/{}",
                    name.replace('~', "~0").replace('/', "~1")
                )
            }));
        }
    }
    let mut search = LoopSearch {
        root,
        visits: HashMap::new(),
    };
    starts.iter().find_map(|start| search.visit(start))
}

enum Visit {
    InProgress,
    Done,
}

/// A depth-first search over the required `$ref` edges between subschemas,
/// keyed by JSON pointer.
struct LoopSearch<'a> {
    root: &'a Value,
    visits: HashMap<String, Visit>,
}

impl LoopSearch<'_> {
    fn visit(&mut self, pointer: &str) -> Option<String> {
        if self.visits.contains_key(pointer) {
            return None;
        }
        let schema = self.root.pointer(pointer)?;
        self.visits.insert(pointer.to_owned(), Visit::InProgress);
        let mut refs = Vec::new();
        required_refs(schema, display_path(pointer), &mut refs);
        for (target, path) in refs {
            match self.visits.get(&target) {
                Some(Visit::InProgress) => return Some(path),
                Some(Visit::Done) => {}
                None => {
                    if let Some(path) = self.visit(&target) {
                        return Some(path);
                    }
                }
            }
        }
        self.visits.insert(pointer.to_owned(), Visit::Done);
        None
    }
}

/// Collects the local `$ref`s every value of `schema` reaches, with where
/// each one is.
fn required_refs(schema: &Value, path: String, refs: &mut Vec<(String, String)>) {
    let Some(object) = schema.as_object() else {
        return;
    };
    if admits_null(schema) {
        return;
    }
    if let Some(target) = object
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|reference| reference.strip_prefix('#'))
    {
        refs.push((target.to_owned(), path.clone()));
    }
    if let Some(properties) = object.get("properties").and_then(Value::as_object) {
        let required = object.get("required").and_then(Value::as_array);
        for (name, property) in properties {
            if required.is_some_and(|names| names.iter().any(|required| required == name)) {
                required_refs(property, child(&path, &format!("properties.{name}")), refs);
            }
        }
    }
    let min_items = object
        .get("minItems")
        .and_then(Value::as_u64)
        .map_or(0, |count| usize::try_from(count).unwrap_or(usize::MAX));
    let prefix_items = object
        .get("prefixItems")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    for (index, item) in prefix_items.iter().enumerate().take(min_items) {
        required_refs(item, child(&path, &format!("prefixItems.{index}")), refs);
    }
    if min_items > prefix_items.len()
        && let Some(items) = object.get("items")
    {
        required_refs(items, child(&path, "items"), refs);
    }
    for keyword in ["anyOf", "oneOf", "allOf"] {
        if let Some(branches) = object.get(keyword).and_then(Value::as_array) {
            for (index, branch) in branches.iter().enumerate() {
                required_refs(branch, child(&path, &format!("{keyword}.{index}")), refs);
            }
        }
    }
}

/// Whether `null` is a valid value, which ends any loop through it.
fn admits_null(schema: &Value) -> bool {
    let typed_null = match schema.get("type") {
        Some(Value::String(kind)) => kind == "null",
        Some(Value::Array(kinds)) => kinds.iter().any(|kind| kind == "null"),
        _ => false,
    };
    typed_null
        || schema.get("nullable") == Some(&Value::Bool(true))
        || schema.get("const") == Some(&Value::Null)
        || schema
            .get("enum")
            .and_then(Value::as_array)
            .is_some_and(|values| values.contains(&Value::Null))
        || ["anyOf", "oneOf"].into_iter().any(|keyword| {
            schema
                .get(keyword)
                .and_then(Value::as_array)
                .is_some_and(|branches| branches.iter().any(admits_null))
        })
}

fn display_path(pointer: &str) -> String {
    pointer
        .split('/')
        .skip(1)
        .map(|segment| segment.replace("~1", "/").replace("~0", "~"))
        .collect::<Vec<_>>()
        .join(".")
}

fn child(path: &str, segment: &str) -> String {
    if path.is_empty() {
        segment.to_owned()
    } else {
        format!("{path}.{segment}")
    }
}
