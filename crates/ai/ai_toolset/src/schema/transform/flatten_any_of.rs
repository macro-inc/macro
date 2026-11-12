use schemars::Schema;
use schemars::transform::Transform;
use serde_json::{Map, Value};

/// Lifts the branches of an `anyOf` that is itself a branch of an `anyOf`.
///
/// Inlining an optional union yields `anyOf: [{anyOf: [...]}, {type: null}]`.
/// The wrapper accepts exactly what its branches accept, but adds two levels
/// of nesting, and Gemini rejects tool schemas nested deeper than
/// [`GEMINI_MAX_SCHEMA_DEPTH`](crate::schema::GEMINI_MAX_SCHEMA_DEPTH). A
/// lifted wrapper's description is appended to the parent's so the model
/// still reads it.
#[derive(Debug, Clone)]
pub struct FlattenNestedAnyOf;

impl Transform for FlattenNestedAnyOf {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };
        let Some(Value::Array(branches)) = obj.get_mut("anyOf") else {
            return;
        };
        let mut flat = Vec::with_capacity(branches.len());
        let mut descriptions = Vec::new();
        for branch in branches.drain(..) {
            lift(branch, &mut flat, &mut descriptions);
        }
        *branches = flat;
        if descriptions.is_empty() {
            return;
        }
        let description = obj
            .get("description")
            .and_then(Value::as_str)
            .into_iter()
            .chain(descriptions.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join("\n\n");
        obj.insert("description".into(), Value::String(description));
    }
}

fn lift(branch: Value, flat: &mut Vec<Value>, descriptions: &mut Vec<String>) {
    match branch {
        Value::Object(mut wrapper) if is_bare_any_of(&wrapper) => {
            if let Some(Value::String(description)) = wrapper.remove("description") {
                descriptions.push(description);
            }
            if let Some(Value::Array(inner)) = wrapper.remove("anyOf") {
                for branch in inner {
                    lift(branch, flat, descriptions);
                }
            }
        }
        branch => flat.push(branch),
    }
}

fn is_bare_any_of(schema: &Map<String, Value>) -> bool {
    matches!(schema.get("anyOf"), Some(Value::Array(_)))
        && schema
            .keys()
            .all(|key| key == "anyOf" || key == "description")
}
