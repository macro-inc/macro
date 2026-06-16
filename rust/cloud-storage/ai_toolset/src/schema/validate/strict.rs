use super::Validate;
use crate::schema::error::ValidationError;
use crate::schema::transform::is_object_schema;
use schemars::Schema;
use serde_json::Value;

/// Rejects schemas containing `$ref` / `$defs` / `definitions`.
///
/// The AI input pipeline inlines all subschemas, so any surviving `$ref`
/// means the type is recursive (schemars falls back to `"$ref": "#"`) —
/// Anthropic strict mode rejects recursive schemas, and there is no
/// transform that can fix this.
pub struct ValidateNoRefs;

impl Validate for ValidateNoRefs {
    fn validate(&self, schema: &Schema) -> Result<(), ValidationError> {
        if let Some(obj) = schema.as_object()
            && (obj.contains_key("$ref")
                || obj.contains_key("$defs")
                || obj.contains_key("definitions"))
        {
            return Err(ValidationError::UnsupportedRef);
        }
        Ok(())
    }
}

/// Rejects object schemas whose `additionalProperties` is anything but
/// `false`.
///
/// schemars emits a value schema there for map types
/// (`HashMap<String, T>`); strict mode on both providers requires
/// `additionalProperties: false`, so map-typed tool inputs cannot be
/// expressed — use a `Vec` of key/value structs instead.
pub struct ValidateAdditionalProperties;

impl Validate for ValidateAdditionalProperties {
    fn validate(&self, schema: &Schema) -> Result<(), ValidationError> {
        let Some(obj) = schema.as_object() else {
            return Ok(());
        };
        if !is_object_schema(obj) {
            return Ok(());
        }
        match obj.get("additionalProperties") {
            Some(Value::Bool(false)) => Ok(()),
            _ => Err(ValidationError::AdditionalProperties),
        }
    }
}

/// Rejects `enum` arrays containing non-primitive values.
///
/// Both providers restrict enum members to strings, numbers, booleans, and
/// nulls.
pub struct ValidateEnumPrimitives;

impl Validate for ValidateEnumPrimitives {
    fn validate(&self, schema: &Schema) -> Result<(), ValidationError> {
        if let Some(values) = schema.get("enum").and_then(Value::as_array)
            && values
                .iter()
                .any(|v| matches!(v, Value::Object(_) | Value::Array(_)))
        {
            return Err(ValidationError::ComplexEnum);
        }
        Ok(())
    }
}
