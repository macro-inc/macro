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
    // A yes before an import plan is ready cannot approve it later.
    assert!(description.contains(
        "For an import plan still being made, do not ask: say they approve it on the card once it is ready, and never offer to start it later."
    ));
}

#[test]
fn decide_review_tells_the_agent_an_early_yes_approved_nothing() {
    let refused = super::review_error(crate::domain::CodeModeError::NotApprovable(
        "This plan isn't ready to approve yet, so nothing was started. Approve it once it's ready."
            .into(),
    ));
    assert_eq!(
        refused.description,
        "This plan isn't ready to approve yet, so nothing was started. Approve it once it's ready. Nothing was approved or queued. Do not promise to start it later: the user approves it on the card once it is ready, or asks you again then."
    );
    // Other refusals are passed on as they are.
    assert_eq!(
        super::review_error(crate::domain::CodeModeError::Conflict).description,
        crate::domain::CodeModeError::Conflict.to_string()
    );
}
