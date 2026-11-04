use super::*;
use schemars::json_schema;
use serde_json::json;

#[test]
fn rejects_composition_at_the_tool_input_root() {
    for keyword in ["oneOf", "anyOf", "allOf"] {
        let mut schema = json_schema!({
            "title": "ComposedInput",
            "description": "A composed tool input",
            "type": "object",
            "properties": {"title": {"type": "string"}},
        });
        schema.insert(
            keyword.into(),
            json!([
                {"type": "object", "properties": {"kind": {"const": "email"}}},
                {"type": "object", "properties": {"kind": {"const": "calendar"}}},
            ]),
        );

        assert!(
            matches!(
                validate_tool_schema(&schema),
                Err(ValidationError::RootComposition)
            ),
            "tool input with root {keyword} must be rejected"
        );
    }
}
