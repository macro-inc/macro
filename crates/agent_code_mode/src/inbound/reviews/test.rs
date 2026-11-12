use super::PresentReview;
use ai_toolset::schema::generate_validated_input_schema;
use serde_json::json;

#[test]
fn review_toolset_passes_schema_validation() {
    let _ = super::toolset();
}

/// Anthropic rejects every request whose tools include a root `oneOf`,
/// `allOf` or `anyOf`, and PresentReview ships to every harness.
#[test]
fn present_review_schema_has_no_root_union() {
    let schema = serde_json::to_value(
        generate_validated_input_schema::<PresentReview>()
            .unwrap()
            .schema,
    )
    .unwrap();

    for keyword in ["oneOf", "allOf", "anyOf"] {
        assert!(schema.get(keyword).is_none(), "root {keyword}: {schema}");
    }
    assert_eq!(schema["type"], "object");
    assert!(schema["properties"]["kind"].is_object());
    assert!(schema["properties"]["title"].is_object());
    assert_eq!(schema["properties"]["drafts"]["type"], "array");
}

#[test]
fn present_review_still_decodes_kind_tagged_drafts() {
    let import: PresentReview = serde_json::from_value(json!({
        "title": "Notion import",
        "kind": "import",
        "drafts": [{"source": "notion"}],
    }))
    .unwrap();
    assert_eq!(import.0.title.as_ref(), "Notion import");

    let mismatched = serde_json::from_value::<PresentReview>(json!({
        "title": "Notion import",
        "kind": "email",
        "drafts": [{"source": "notion"}],
    }));
    assert!(mismatched.is_err());
}

#[test]
fn present_review_skips_the_offer_when_the_user_held_the_send() {
    let schema = serde_json::to_value(
        generate_validated_input_schema::<PresentReview>()
            .unwrap()
            .schema,
    )
    .unwrap();
    let description = schema["description"].as_str().unwrap();
    assert!(description.contains("\"Should I kick it off?\""));
    assert!(description.contains(
        "If they said not to send, create or import it yet, do not ask; say it is waiting on the card for them."
    ));
}
