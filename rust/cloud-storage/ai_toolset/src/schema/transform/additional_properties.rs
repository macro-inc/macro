use schemars::Schema;
use schemars::transform::Transform;
use serde_json::Value;

/// Sets `additionalProperties: false` on every object schema, as required by
/// both OpenAI and Anthropic strict mode.
///
/// Only applies to object-typed schemas — strict validators reject (or are
/// confused by) the keyword on scalars and arrays. An existing
/// `additionalProperties` value is left untouched: schemars emits a value
/// *schema* there for map types (`HashMap<String, T>`), which strict mode
/// cannot express — overwriting it would silently change the tool's
/// contract, so it is left for [`ValidateAdditionalProperties`] to reject.
///
/// [`ValidateAdditionalProperties`]: crate::schema::validate::ValidateAdditionalProperties
#[derive(Debug, Clone)]
pub struct AdditionalPropertiesFalse;

pub(crate) fn is_object_schema(obj: &serde_json::Map<String, Value>) -> bool {
    let type_is_object = match obj.get("type") {
        Some(Value::String(t)) => t == "object",
        Some(Value::Array(types)) => types.iter().any(|t| t == "object"),
        _ => false,
    };
    type_is_object || obj.contains_key("properties")
}

impl Transform for AdditionalPropertiesFalse {
    fn transform(&mut self, schema: &mut Schema) {
        let Some(obj) = schema.as_object_mut() else {
            return;
        };
        if !is_object_schema(obj) {
            return;
        }
        if !obj.contains_key("additionalProperties") {
            obj.insert("additionalProperties".to_string(), false.into());
        }
    }
}
