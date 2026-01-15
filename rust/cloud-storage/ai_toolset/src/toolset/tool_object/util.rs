use super::object::ValidationError;
use schemars::{
    Schema, SchemaGenerator,
    generate::SchemaSettings,
    transform::{RecursiveTransform, Transform},
};

/// Validates a tool's input schema against OpenAI's structured output requirements.
///
/// Returns the tool's name and description extracted from the schema metadata.
/// See: <https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#supported-schemas>
pub fn validate_tool_schema(schema: &Schema) -> Result<(String, String), ValidationError> {
    let name = schema
        .get("title")
        .and_then(|title| title.as_str())
        .ok_or(ValidationError::MissingMetadata)?
        .to_string();
    validate_title(&name)?;

    let description = schema
        .get("description")
        .and_then(|description| description.as_str())
        .ok_or(ValidationError::MissingMetadata)?
        .to_string();

    ValidateNoOneOf.visit(schema);

    Ok((name, description))
}

// Visitor trait based on schemars Transform
// but does not take ownership of or mutate schema
trait Visit {
    fn visit(&self, schema: &Schema);
}

struct ValidateNoOneOf;

impl Visit for ValidateNoOneOf {
    fn visit(&self, schema: &Schema) {
        if schema.get("oneOf").is_some() {
            panic!("{}", ValidationError::OneOf);
        }

        visit_subschemas(self, schema);
    }
}

// based on transform_subschemas in schemars
fn visit_subschemas<T: Visit + ?Sized>(t: &T, schema: &Schema) {
    for (key, value) in schema.as_object().into_iter().flatten() {
        // This is intentionally written to work with multiple JSON Schema versions, so that
        // users can add their own transforms on the end of e.g. `SchemaSettings::draft07()` and
        // they will still apply to all subschemas "as expected".
        // This is why this match statement contains both `additionalProperties` (which was
        // dropped in draft 2020-12) and `prefixItems` (which was added in draft 2020-12).
        match key.as_str() {
            "not"
            | "if"
            | "then"
            | "else"
            | "contains"
            | "additionalProperties"
            | "propertyNames"
            | "additionalItems" => {
                if let Ok(subschema) = value.try_into() {
                    t.visit(subschema);
                }
            }
            "allOf" | "anyOf" | "oneOf" | "prefixItems" => {
                if let Some(array) = value.as_array() {
                    for value in array {
                        if let Ok(subschema) = value.try_into() {
                            t.visit(subschema);
                        }
                    }
                }
            }
            // Support `items` array even though this is not allowed in draft 2020-12 (see above
            // comment)
            "items" => {
                if let Some(array) = value.as_array() {
                    for value in array {
                        if let Ok(subschema) = value.try_into() {
                            t.visit(subschema);
                        }
                    }
                } else if let Ok(subschema) = value.try_into() {
                    t.visit(subschema);
                }
            }
            "properties" | "patternProperties" | "$defs" | "definitions" => {
                if let Some(obj) = value.as_object() {
                    for value in obj.values() {
                        if let Ok(subschema) = value.try_into() {
                            t.visit(subschema);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

#[derive(Debug, Clone)]
struct AddRequired;

// adds all property names to required array
impl Transform for AddRequired {
    fn transform(&mut self, schema: &mut Schema) {
        let properties = match schema.as_object() {
            Some(obj) => match obj.get("properties") {
                Some(properties) => properties,
                None => {
                    return;
                }
            },
            None => {
                return;
            }
        };
        let property_names = match properties.as_object() {
            Some(properties) => properties
                .keys()
                .map(|key| key.to_string())
                .collect::<Vec<_>>(),
            None => {
                return;
            }
        };
        schema.insert("required".to_string(), property_names.into());
    }
}

#[derive(Debug, Clone)]
struct AdditionalPropertiesFalse;

// adds additionalProperties: false for all objects
impl Transform for AdditionalPropertiesFalse {
    fn transform(&mut self, schema: &mut Schema) {
        if let Some(obj) = schema.as_object_mut() {
            obj.insert("additionalProperties".to_string(), false.into());
        }
    }
}

/// Creates a schema generator configured for tool input schemas.
///
/// The generated schemas include `required` arrays for all properties and
/// `additionalProperties: false` as required by OpenAI's structured outputs.
pub fn input_schema_generator() -> SchemaGenerator {
    SchemaSettings::draft2020_12()
        .with(|s| {
            s.meta_schema = None;
            s.inline_subschemas = true;
        })
        .with_transform(RecursiveTransform(AddRequired))
        .with_transform(RecursiveTransform(AdditionalPropertiesFalse))
        .into_generator()
}

/// Schema transform that simplifies output schemas for AI consumption.
///
/// Removes unnecessary fields like `title`, `format`, `required`, `type`, etc.,
/// keeping only property names and descriptions.
#[derive(Debug, Clone)]
pub struct MinimizedOutput;

impl Transform for MinimizedOutput {
    fn transform(&mut self, schema: &mut Schema) {
        if let Some(obj) = schema.as_object_mut() {
            obj.remove("title");
            obj.remove("format");
            obj.remove("required");
            obj.remove("additionalProperties");
            obj.remove("type");
            obj.remove("$ref");
            obj.remove("$defs");
        }
    }
}

/// Creates a schema generator that produces minimized output schemas.
///
/// Uses [`MinimizedOutput`] transform to strip unnecessary schema fields.
pub fn minimized_output_schema_generator() -> SchemaGenerator {
    SchemaSettings::draft2020_12()
        .with(|s| {
            s.meta_schema = None;
            s.inline_subschemas = true;
        })
        .with_transform(RecursiveTransform(MinimizedOutput))
        .into_generator()
}

/// Creates a schema generator for tool output schemas.
///
/// Uses draft 2020-12 settings with inlined subschemas and no meta schema.
pub fn output_schema_generator() -> SchemaGenerator {
    SchemaSettings::draft2020_12()
        .with(|s| {
            s.meta_schema = None;
            s.inline_subschemas = true;
        })
        .into_generator()
}

/// Generates a JSON schema for a tool's input parameters.
///
/// Uses [`input_schema_generator`] to create a schema compliant with
/// OpenAI's structured output requirements.
#[macro_export]
macro_rules! generate_tool_input_schema {
    ($tool:ty) => {{
        use $crate::tool_object::input_schema_generator;
        input_schema_generator().into_root_schema_for::<$tool>()
    }};
}

/// Generates a JSON schema for a tool's output type.
///
/// Uses [`output_schema_generator`] to create a standard JSON schema.
#[macro_export]
macro_rules! generate_tool_output_schema {
    ($tool:ty) => {{
        use $crate::tool_object::output_schema_generator;
        output_schema_generator().into_root_schema_for::<$tool>()
    }};
}

fn validate_title(title: &str) -> Result<(), ValidationError> {
    if title.is_empty() {
        return Err(ValidationError::EmptyTitle);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use schemars::JsonSchema;
    use serde::Deserialize;

    // Test struct with valid schema (should pass)
    #[derive(Debug, JsonSchema, Deserialize, Clone)]
    #[schemars(
        description = "Valid test schema with simple properties",
        title = "ValidTestSchema"
    )]
    #[allow(dead_code)]
    struct ValidTestSchema {
        #[schemars(description = "A simple string field")]
        pub simple_field: Option<String>,

        #[schemars(description = "A vector of strings")]
        pub list_field: Option<Vec<String>>,

        #[schemars(description = "A boolean flag")]
        pub flag_field: Option<bool>,

        #[schemars(description = "An integer value")]
        pub number_field: Option<i32>,
    }

    // Test enum with doc comments that should cause oneOf (should fail)
    #[derive(Debug, JsonSchema, Deserialize, Clone)]
    #[schemars(
        description = "Invalid enum with doc comments that generates oneOf",
        title = "InvalidEnumSchema"
    )]
    #[allow(dead_code)]
    struct InvalidEnumSchema {
        #[schemars(description = "An enum that will generate oneOf")]
        pub enum_field: BadEnum,
    }

    // Enum with doc comments that will cause oneOf generation
    #[derive(Debug, JsonSchema, Deserialize, Clone)]
    #[allow(dead_code)]
    enum BadEnum {
        /// This doc comment will cause oneOf
        Variant1,
        /// This doc comment will also cause oneOf
        Variant2,
    }

    #[test]
    fn test_validate_tool_schema_passes() {
        let schema = generate_tool_input_schema!(ValidTestSchema);

        let result = validate_tool_schema(&schema);
        assert!(
            result.is_ok(),
            "Valid schema should pass validation: {:?}",
            result
        );

        let (name, description) = result.unwrap();
        assert_eq!(name, "ValidTestSchema");
        assert_eq!(description, "Valid test schema with simple properties");
    }

    #[test]
    #[should_panic(expected = "schema must not have oneOf set")]
    fn test_validate_tool_schema_fails_on_one_of() {
        let schema = generate_tool_input_schema!(InvalidEnumSchema);

        // This should panic when oneOf is detected
        let _result = validate_tool_schema(&schema);
    }
}
