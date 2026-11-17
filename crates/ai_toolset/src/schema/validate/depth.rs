use schemars::Schema;
use serde_json::Value;

use crate::schema::error::ValidationError;

#[cfg(test)]
mod test;

/// The deepest tool input schema Gemini accepts, counting each non-empty
/// JSON object or array as a level. A deeper schema fails the whole request
/// with a bare 400 INVALID_ARGUMENT that names no field.
pub const GEMINI_MAX_SCHEMA_DEPTH: usize = 30;

/// Rejects a schema nested deeper than [`GEMINI_MAX_SCHEMA_DEPTH`].
pub fn validate_gemini_nesting_depth(schema: &Schema) -> Result<(), ValidationError> {
    let (depth, path) = deepest_path(schema.as_value());
    if depth > GEMINI_MAX_SCHEMA_DEPTH {
        return Err(ValidationError::TooDeep {
            depth,
            path: path.join("."),
        });
    }
    Ok(())
}

/// How many levels of non-empty JSON objects and arrays `value` nests, as
/// Gemini counts them. Scalars and empty containers add none.
pub fn nesting_depth(value: &Value) -> usize {
    deepest_path(value).0
}

fn deepest_path(value: &Value) -> (usize, Vec<String>) {
    let children: Vec<(String, &Value)> = match value {
        Value::Object(map) => map
            .iter()
            .map(|(key, child)| (key.clone(), child))
            .collect(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, child)| (index.to_string(), child))
            .collect(),
        _ => return (0, Vec::new()),
    };
    children
        .into_iter()
        .map(|(key, child)| {
            let (depth, mut path) = deepest_path(child);
            path.insert(0, key);
            (depth + 1, path)
        })
        .max_by_key(|(depth, _)| *depth)
        .unwrap_or_default()
}
