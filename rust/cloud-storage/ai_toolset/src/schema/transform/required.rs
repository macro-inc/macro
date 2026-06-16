use schemars::Schema;
use schemars::transform::Transform;
use serde_json::Value;

/// Adds all property names to the `required` array, as required by
/// OpenAI's strict mode.
///
/// Must run **after** [`NullifyOptional`](super::NullifyOptional), which
/// reads the original `required` array to decide which properties need a
/// null union before this transform overwrites it.
#[derive(Debug, Clone)]
pub struct AddRequired;

impl Transform for AddRequired {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };
        let Some(properties) = obj.get("properties").and_then(Value::as_object) else {
            return;
        };
        let property_names: Vec<Value> = properties.keys().cloned().map(Value::String).collect();
        obj.insert("required".to_string(), Value::Array(property_names));
    }
}
