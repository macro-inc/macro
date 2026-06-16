//! Entry points for tool schema generation — one function per codepath.
//!
//! Both pipelines start from the same Rust tool types but produce different
//! shapes for different consumers. The full list of transforms each codepath
//! applies is visible in its function body here; the building blocks live in
//! the private `transform`, `validate`, and `frontend_typegen` modules.

#[cfg(test)]
mod test;

use crate::schema::error::ValidationError;
use crate::schema::frontend_typegen::FrontendSchemasBuilder;
use crate::schema::transform::{
    AddRequired, AdditionalPropertiesFalse, NormaliseRefSiblings, NullifyOptional, OneOfToAnyOf,
    StripUnsupported,
};
use crate::schema::validate::validate_tool_schema;
use schemars::Schema;
use schemars::generate::SchemaSettings;
use schemars::transform::RecursiveTransform;

/// The transformed and valid schema representing a tool
#[derive(Debug, Clone)]
pub struct ValidatedSchema {
    /// The tool name, extracted from the schema's `title`.
    pub name: String,
    /// The tool description, extracted from the schema's `description`.
    pub description: String,
    /// The transformed input schema.
    pub schema: Schema,
}

/// **AI input codepath**: generates the input schema for `T` that an AI
/// provider receives, transforms it to satisfy strict mode on both OpenAI
/// and Anthropic, then validates what transforms cannot fix.
///
/// Transforms (in order):
/// 1. subschemas inlined — providers get one self-contained schema
/// 2. [`OneOfToAnyOf`] — `oneOf` is unsupported by both providers; `anyOf`
///    is supported by both
/// 3. [`StripUnsupported`] — numeric/string/array constraints and
///    non-whitelisted `format`s are removed and recorded in `description`
/// 4. [`NullifyOptional`] — properties not in `required` get a null union;
///    strict mode forbids optionality, so "may be omitted" becomes "may be
///    null"
/// 5. [`AddRequired`] — every property listed in `required`, as OpenAI
///    requires (must run after [`NullifyOptional`])
/// 6. [`AdditionalPropertiesFalse`] — `additionalProperties: false` on
///    every object (both providers require it)
///
/// Validation then rejects what cannot be transformed: missing
/// title/description, a non-object root, recursive types (surviving
/// `$ref`s), map types (`additionalProperties` schemas), non-primitive
/// enums, and residual `oneOf`. Never panics — failures are returned as
/// [`ValidationError`]s.
pub fn generate_validated_input_schema<T: schemars::JsonSchema>()
-> Result<ValidatedSchema, ValidationError> {
    let schema = SchemaSettings::draft2020_12()
        .with(|s| {
            s.meta_schema = None;
            s.inline_subschemas = true;
        })
        .with_transform(RecursiveTransform(OneOfToAnyOf))
        .with_transform(RecursiveTransform(StripUnsupported))
        .with_transform(RecursiveTransform(NullifyOptional))
        .with_transform(RecursiveTransform(AddRequired))
        .with_transform(RecursiveTransform(AdditionalPropertiesFalse))
        .into_generator()
        .into_root_schema_for::<T>();
    let (name, description) = validate_tool_schema(&schema)?;
    Ok(ValidatedSchema {
        name,
        description,
        schema,
    })
}

/// **Frontend typegen codepath**: returns a builder that accumulates tool
/// types into shared, deduplicated `$defs` for TypeScript codegen.
///
/// `$ref`s are preserved (types referenced by multiple tools appear exactly
/// once) and `$ref` nodes with sibling keywords are normalised for the
/// downstream TS tooling. None of the AI structured-output transforms apply
/// here, and the result is never sent to an AI provider.
pub fn frontend_schemas_builder() -> FrontendSchemasBuilder {
    let generator = SchemaSettings::draft2020_12()
        .with(|s| s.meta_schema = None)
        .with_transform(RecursiveTransform(NormaliseRefSiblings))
        .into_generator();
    FrontendSchemasBuilder::new(generator)
}
