//! JavaScript object marshalling, distinct from JSON.stringify document snapshots.
use crate::replay::*;
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, sync::LazyLock};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Properties {
    class_types: HashMap<String, String>,
    class_references: HashMap<String, String>,
    own_undefined: HashMap<String, Vec<String>>,
}
static PROPERTIES: LazyLock<Properties> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../macro_document_model/tests/corpus/wire-properties.json"
    ))
    .expect("generated source class properties")
});
pub(crate) fn class_type(name: &str) -> Option<&'static str> {
    PROPERTIES.class_types.get(name).map(String::as_str)
}
pub(crate) fn class_reference(reference: &str) -> Option<&'static str> {
    PROPERTIES
        .class_references
        .get(reference)
        .map(String::as_str)
}
/// Preserve source own properties whose undefined values JSON.stringify omits.
pub(crate) fn exported_object(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        if let Some(fields) = object
            .get("type")
            .and_then(Value::as_str)
            .and_then(|name| PROPERTIES.own_undefined.get(name))
        {
            for field in fields {
                object.entry(field.clone()).or_insert_with(undefined);
            }
        }
        if let Some(children) = object.get_mut("children").and_then(Value::as_array_mut) {
            for child in children {
                *child = exported_object(std::mem::take(child));
            }
        }
        if let Some(root) = object.get_mut("root") {
            *root = exported_object(std::mem::take(root));
        }
    }
    value
}

/// JSON serialization drops undefined own properties and uses null in arrays.
pub(crate) fn json_value(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.retain(|_, value| !is_undefined(value));
        for value in object.values_mut() {
            *value = json_value(std::mem::take(value));
        }
    } else if let Some(array) = value.as_array_mut() {
        for value in array {
            *value = if is_undefined(value) {
                Value::Null
            } else {
                json_value(std::mem::take(value))
            };
        }
    }
    value
}

fn is_undefined(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.len() == 1 && object.get("$undef") == Some(&Value::Bool(true)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn undefined_serialization_preserves_literal_marker_like_payloads() {
        assert_eq!(
            json_value(json!({
                "missing": {"$undef": true},
                "literal": {"$undef": false, "n": 1},
                "blockParams": {"$undef": "literal"},
                "array": [{"$undef":true}, {"$undef":false,"n":1}]
            })),
            json!({
                "literal": {"$undef":false,"n":1},
                "blockParams": {"$undef":"literal"},
                "array": [null, {"$undef":false,"n":1}]
            })
        );
    }
}
