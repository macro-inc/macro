//! Validators applied to generated AI input schemas.
//!
//! Internal to the `schema` module — outside consumers go through
//! [`generate_validated_input_schema`](super::generate::generate_validated_input_schema)
//! instead.

mod depth;
mod extract;
mod one_of;
mod recursive;
mod ref_loop;

#[cfg(test)]
mod test;

use super::error::ValidationError;
use extract::Extract;
use schemars::Schema;

pub use depth::{GEMINI_MAX_SCHEMA_DEPTH, nesting_depth, validate_gemini_nesting_depth};
pub use one_of::ValidateNoOneOf;
pub use recursive::RecursiveValidate;
pub use ref_loop::{required_ref_loop, validate_no_required_ref_loop};

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
/// both OpenAI and Anthropic, and the schemas Gemini accepts.
///
/// Returns the tool's name and description extracted from the schema
/// metadata. Requires an object root without `oneOf`, `anyOf`, or `allOf`,
/// and rejects residual `oneOf` throughout the schema. Nested `anyOf` is
/// supported, so tagged variants belong under a named property. Rejects a
/// `$ref` loop made only of required fields and nesting deeper than
/// [`GEMINI_MAX_SCHEMA_DEPTH`], both of which Gemini refuses.
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

    if ["oneOf", "anyOf", "allOf"]
        .into_iter()
        .any(|keyword| schema.get(keyword).is_some())
    {
        return Err(ValidationError::RootComposition);
    }

    RecursiveValidate(ValidateNoOneOf).validate(schema)?;
    validate_no_required_ref_loop(schema)?;
    validate_gemini_nesting_depth(schema)?;

    Ok((name, description))
}
