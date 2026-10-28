//! Validators applied to generated AI input schemas.
//!
//! Internal to the `schema` module — outside consumers go through
//! [`generate_validated_input_schema`](super::generate::generate_validated_input_schema)
//! instead.

mod extract;
mod one_of;
mod recursive;

use super::error::ValidationError;
use extract::Extract;
use schemars::Schema;

pub use one_of::ValidateNoOneOf;
pub use recursive::RecursiveValidate;

/// A validating visitor similar to [`Transform`](schemars::transform::Transform)
///
/// Validators only see one schema node at a time and never traverse; wrap one
/// in [`RecursiveValidate`] to apply it to a schema and all of its subschemas.
/// Schema rewrites belong in [`Transform`](schemars::transform::Transform)s
/// applied via
/// [`RecursiveTransform`](schemars::transform::RecursiveTransform), not here.
pub trait Validate {
    fn validate(&self, schema: &Schema) -> Result<(), ValidationError>;
}

/// Validates a tool's input schema against the strict-mode requirements of
/// both OpenAI and Anthropic.
///
/// Returns the tool's name and description extracted from the schema
/// metadata. Checks what the transforms cannot fix: surviving `$ref`s
/// (recursive types), non-`false` `additionalProperties` (map types),
/// non-primitive enum members, residual `oneOf`, and a non-object root.
///
/// See:
/// * <https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use>
/// * <https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations>
/// * <https://developers.openai.com/api/docs/guides/function-calling>
pub fn validate_tool_schema(schema: &Schema) -> Result<(String, String), ValidationError> {
    let name = Extract::new("title").extract(schema)?;

    let description = Extract::new("description").extract(schema)?;

    if schema.get("type").and_then(serde_json::Value::as_str) != Some("object") {
        return Err(ValidationError::RootNotObject);
    }

    RecursiveValidate(ValidateNoOneOf).validate(schema)?;

    Ok((name, description))
}
