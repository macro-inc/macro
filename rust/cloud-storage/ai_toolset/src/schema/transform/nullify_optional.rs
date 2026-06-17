use schemars::Schema;
use schemars::transform::Transform;
use serde_json::{Map, Value, json};

/// Rewrites optional properties (not listed in `required`) to accept `null`.
///
/// OpenAI strict mode forbids optional properties — optionality must be
/// expressed as a union with `null`. This transform makes that rewrite;
/// [`AddRequired`](super::AddRequired) then marks everything required, and
/// must run **after** this transform since it overwrites the `required`
/// array this one reads. `Option<T>` fields are already nullable and pass
/// through unchanged; this catches properties that are optional any other
/// way (e.g. `#[serde(default)]` fields).
#[derive(Debug, Clone)]
pub struct NullifyOptional;

impl Transform for NullifyOptional {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };

        let required: Vec<String> = obj
            .get("required")
            .and_then(Value::as_array)
            .map(|names| {
                names
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        let Some(properties) = obj.get_mut("properties").and_then(Value::as_object_mut) else {
            return;
        };
        for (name, property) in properties.iter_mut() {
            if !required.iter().any(|r| r == name) {
                make_nullable(property);
            }
        }
    }
}

fn has_null_type(obj: &Map<String, Value>) -> bool {
    match obj.get("type") {
        Some(Value::String(t)) => t == "null",
        Some(Value::Array(types)) => types.iter().any(|t| t == "null"),
        _ => false,
    }
}

fn make_nullable(property: &mut Value) {
    let Some(obj) = property.as_object_mut() else {
        return;
    };

    // Union node: add a null variant unless one exists.
    if let Some(Value::Array(variants)) = obj.get_mut("anyOf") {
        let has_null = variants
            .iter()
            .any(|v| v.as_object().is_some_and(has_null_type));
        if !has_null {
            variants.push(json!({"type": "null"}));
        }
        return;
    }

    match obj.get("type").cloned() {
        Some(Value::String(t)) => {
            if t != "null" {
                obj.insert("type".to_string(), json!([t, "null"]));
            }
        }
        Some(Value::Array(mut types)) => {
            if !types.iter().any(|t| t == "null") {
                types.push(json!("null"));
                obj.insert("type".to_string(), Value::Array(types));
            }
        }
        _ => {
            // const / allOf / other shapes that can't carry a type union:
            // wrap the whole node in a null union instead.
            let original = Value::Object(std::mem::take(obj));
            *property = json!({"anyOf": [original, {"type": "null"}]});
            return;
        }
    }

    // An enum must also admit null now that the type does.
    if let Some(Value::Array(values)) = obj.get_mut("enum")
        && !values.iter().any(Value::is_null)
    {
        values.push(Value::Null);
    }
}
