use super::*;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

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

// Enum variant doc comments make schemars emit oneOf; the pipeline rewrites
// it to anyOf, which both providers accept in strict mode.
#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[schemars(
    description = "Enum with doc comments generates oneOf, rewritten to anyOf",
    title = "DocumentedEnumSchema"
)]
#[allow(dead_code)]
struct DocumentedEnumSchema {
    #[schemars(description = "An enum whose variants carry descriptions")]
    pub enum_field: DocumentedEnum,
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[allow(dead_code)]
enum DocumentedEnum {
    /// This doc comment causes oneOf
    Variant1,
    /// This doc comment also causes oneOf
    Variant2,
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[schemars(
    description = "Schema with provider-unsupported constraints",
    title = "Constrained"
)]
#[allow(dead_code)]
struct Constrained {
    #[schemars(description = "An unsigned counter")]
    pub count: u32,

    #[schemars(description = "A bounded string", length(min = 1, max = 10))]
    pub bounded: String,

    #[schemars(description = "A uuid", extend("format" = "uuid"))]
    pub id: String,
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[schemars(description = "Schema with a map field", title = "WithMap")]
#[allow(dead_code)]
struct WithMap {
    pub map_field: HashMap<String, String>,
}

#[derive(Debug, JsonSchema, Deserialize, Clone, Default)]
#[allow(dead_code)]
enum PlainEnum {
    #[default]
    Red,
    Blue,
}

// Fields that are optional without being Option (serde defaults): strict
// mode requires them to become required + nullable.
#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[schemars(
    description = "Schema with serde-default fields",
    title = "WithDefaults"
)]
#[allow(dead_code)]
struct WithDefaults {
    pub always: String,

    #[serde(default)]
    #[schemars(description = "An optional counter")]
    pub count: u32,

    #[serde(default)]
    pub color: PlainEnum,
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[schemars(description = "A recursive schema", title = "Recursive")]
#[allow(dead_code)]
struct Recursive {
    pub children: Vec<Recursive>,
}

fn schema_json(schema: &Schema) -> Value {
    serde_json::to_value(schema).expect("schema serializes")
}

fn property<'a>(json: &'a Value, name: &str) -> &'a Value {
    &json["properties"][name]
}

#[test]
fn test_validate_tool_schema_passes() {
    let result = generate_validated_input_schema::<ValidTestSchema>();
    assert!(
        result.is_ok(),
        "Valid schema should pass validation: {:?}",
        result
    );

    let validated = result.unwrap();
    assert_eq!(validated.name, "ValidTestSchema");
    assert_eq!(
        validated.description,
        "Valid test schema with simple properties"
    );
}

#[test]
fn test_optional_fields_are_required_and_nullable() {
    let validated = generate_validated_input_schema::<ValidTestSchema>().unwrap();
    let json = schema_json(&validated.schema);

    // OpenAI strict mode: every property must be in `required`; optional
    // fields are expressed as nullable unions instead.
    let required: Vec<&str> = json["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    for field in ["simple_field", "list_field", "flag_field", "number_field"] {
        assert!(required.contains(&field), "{field} must be required");
    }
    let types = property(&json, "simple_field")["type"].as_array().unwrap();
    assert!(types.contains(&Value::String("null".into())), "{types:?}");
}

#[test]
fn test_additional_properties_only_on_objects() {
    let validated = generate_validated_input_schema::<ValidTestSchema>().unwrap();
    let json = schema_json(&validated.schema);

    assert_eq!(json["additionalProperties"], Value::Bool(false));
    // Scalars and arrays must not carry the keyword.
    for field in ["simple_field", "list_field", "flag_field", "number_field"] {
        assert!(
            property(&json, field).get("additionalProperties").is_none(),
            "{field} should not have additionalProperties"
        );
    }
}

#[test]
fn test_enum_doc_comments_rewritten_to_any_of() {
    let result = generate_validated_input_schema::<DocumentedEnumSchema>();
    assert!(result.is_ok(), "{result:?}");

    let json = schema_json(&result.unwrap().schema);
    let enum_field = property(&json, "enum_field");
    assert!(enum_field.get("oneOf").is_none(), "oneOf must be rewritten");
    let variants = enum_field["anyOf"].as_array().expect("anyOf present");
    assert_eq!(variants.len(), 2);
    assert_eq!(variants[0]["const"], "Variant1");
    assert!(variants[0]["description"].is_string());
}

#[test]
fn test_unsupported_constraints_stripped_into_description() {
    let validated = generate_validated_input_schema::<Constrained>().unwrap();
    let json = schema_json(&validated.schema);

    // u32: schemars emits `minimum: 0` (Anthropic-rejected) and
    // `format: "uint32"` (a type-width artifact, dropped silently).
    let count = property(&json, "count");
    assert!(count.get("minimum").is_none());
    assert!(count.get("format").is_none());
    assert!(
        count["description"]
            .as_str()
            .unwrap()
            .contains("minimum: 0"),
        "stripped constraint should be noted in the description"
    );

    // minLength/maxLength are rejected by both providers.
    let bounded = property(&json, "bounded");
    assert!(bounded.get("minLength").is_none());
    assert!(bounded.get("maxLength").is_none());
    let description = bounded["description"].as_str().unwrap();
    assert!(description.contains("A bounded string"));
    assert!(description.contains("minLength: 1"));
    assert!(description.contains("maxLength: 10"));

    // `uuid` is on both providers' format whitelist and survives.
    assert_eq!(property(&json, "id")["format"], "uuid");
}

#[test]
fn test_serde_default_fields_become_required_and_nullable() {
    let validated = generate_validated_input_schema::<WithDefaults>().unwrap();
    let json = schema_json(&validated.schema);

    let required: Vec<&str> = json["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    for field in ["always", "count", "color"] {
        assert!(required.contains(&field), "{field} must be required");
    }

    // An already-required field keeps its plain type.
    assert_eq!(property(&json, "always")["type"], "string");

    // A promoted scalar becomes a null union.
    let count_types = property(&json, "count")["type"].as_array().unwrap();
    assert!(count_types.contains(&Value::String("integer".into())));
    assert!(count_types.contains(&Value::String("null".into())));

    // A promoted enum admits null in both `type` and `enum`.
    let color = property(&json, "color");
    let color_types = color["type"].as_array().unwrap();
    assert!(
        color_types.contains(&Value::String("null".into())),
        "{color:?}"
    );
    let values = color["enum"].as_array().unwrap();
    assert!(values.contains(&Value::Null), "{values:?}");
    assert!(values.contains(&Value::String("Red".into())));
}

#[test]
fn test_map_types_fail_validation() {
    let result = generate_validated_input_schema::<WithMap>();
    assert!(
        matches!(result, Err(ValidationError::AdditionalProperties)),
        "map types cannot be expressed in strict mode: {result:?}"
    );
}

#[test]
fn test_recursive_types_fail_validation() {
    let result = generate_validated_input_schema::<Recursive>();
    assert!(
        matches!(result, Err(ValidationError::UnsupportedRef)),
        "recursive types cannot be inlined: {result:?}"
    );
}
