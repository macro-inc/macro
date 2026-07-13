use schemars::Schema;
use schemars::transform::Transform;

/// Normalises `$ref` nodes that carry sibling keywords.
///
/// Downstream TS tooling (`json-schema-to-typescript`) predates Draft 2020-12
/// and doesn't merge `$ref` with sibling keywords. This [`schemars::Transform`]
/// rewrites those nodes so the output is consumable:
///
/// * `$ref` + `description` only → drops the description (the referenced type
///   already carries its own).
/// * `$ref` + structural siblings (`properties`, `required`, …) → rewrites to
///   `allOf` so the intersection is explicit.
#[derive(Debug, Clone)]
pub struct NormaliseRefSiblings;

impl Transform for NormaliseRefSiblings {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };
        if !obj.contains_key("$ref") {
            return;
        }

        let sibling_keys: Vec<String> = obj
            .keys()
            .filter(|k| *k != "$ref" && *k != "$schema")
            .cloned()
            .collect();

        if sibling_keys.is_empty() {
            return;
        }

        if sibling_keys == ["description"] {
            obj.remove("description");
            return;
        }

        let ref_val = obj.remove("$ref").unwrap();
        let mut ref_part = serde_json::Map::new();
        ref_part.insert("$ref".to_string(), ref_val);

        let mut sibling_part = serde_json::Map::new();
        for key in &sibling_keys {
            if key == "description" {
                continue;
            }
            if let Some(val) = obj.remove(key) {
                sibling_part.insert(key.clone(), val);
            }
        }
        obj.remove("description");

        obj.insert(
            "allOf".to_string(),
            serde_json::json!([
                serde_json::Value::Object(ref_part),
                serde_json::Value::Object(sibling_part),
            ]),
        );
    }
}
