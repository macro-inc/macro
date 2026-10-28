use super::{PresentView, toolset};
use ai_toolset::schema::generate_validated_input_schema;
use serde_json::{Value, json};

fn assert_local_refs_resolve(root: &Value, node: &Value) {
    match node {
        Value::Object(fields) => {
            if let Some(reference) = fields.get("$ref").and_then(Value::as_str) {
                let pointer = reference.strip_prefix('#').expect("local schema reference");
                assert!(
                    root.pointer(pointer).is_some(),
                    "unresolved reference {reference}"
                );
            }
            for child in fields.values() {
                assert_local_refs_resolve(root, child);
            }
        }
        Value::Array(items) => {
            for child in items {
                assert_local_refs_resolve(root, child);
            }
        }
        _ => {}
    }
}

#[test]
fn present_view_advertises_the_whole_view_schema_at_the_tool_root() {
    let validated = generate_validated_input_schema::<PresentView>().expect("valid schema");
    assert_eq!(validated.name, "PresentView");
    assert!(validated.description.contains("the user will not ask"));
    let schema = serde_json::to_value(validated.schema).expect("serialize schema");
    assert_eq!(schema["required"], json!(["view"]));
    assert!(schema["$defs"].is_object());
    assert_local_refs_resolve(&schema, &schema);
}

#[test]
fn present_view_sits_with_the_review_tools() {
    let tools = toolset();
    assert!(tools.tools.contains_key("PresentView"));
    assert!(tools.tools.contains_key("PresentReview"));
}
