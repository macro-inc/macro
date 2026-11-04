use super::*;

#[test]
fn review_toolset_passes_provider_schema_validation() {
    let tools = toolset();
    let schema = &tools.tools["PresentReview"].input_schema;
    assert_eq!(schema["required"], json!(["review"]));
    assert!(schema.get("anyOf").is_none());
    assert_eq!(
        schema["properties"]["review"]["anyOf"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn present_review_accepts_named_and_previously_advertised_flat_arguments() {
    for review in [
        json!({"kind": "email", "title": "Draft", "drafts": [{
            "subject": "Review", "body": "Draft body", "to": [{"email": "user@example.com"}]
        }]}),
        json!({"kind": "calendar", "title": "Draft", "drafts": [{
            "title": "Meeting", "time": {"kind": "timed", "startsAt": "2026-01-01T10:00:00Z", "endsAt": "2026-01-01T11:00:00Z"}
        }]}),
        json!({"kind": "import", "title": "Import", "drafts": [{"source": "notion"}]}),
    ] {
        let flat: PresentReview = serde_json::from_value(review.clone()).unwrap();
        let wrapped: PresentReview = serde_json::from_value(json!({"review": review})).unwrap();
        assert_eq!(
            serde_json::to_value(flat.review).unwrap(),
            serde_json::to_value(wrapped.review).unwrap()
        );
    }
}
