use super::*;
use serde_json::json;

#[test]
fn review_validation_uses_existing_action_contracts() {
    let tools = ai_tools::code_mode_tools();
    let email = json!({"subject":"Review", "body":"**Markdown**", "to":[{"email":"recipient@example.com"}]});
    assert!(validate_draft(&tools, ReviewKind::Email, &email).is_ok());
    assert!(
        validate_draft(
            &tools,
            ReviewKind::Email,
            &json!({"subject":"missing body"})
        )
        .is_err()
    );
    assert!(
        validate_draft(
            &tools,
            ReviewKind::Calendar,
            &json!({"title":"missing time"})
        )
        .is_err()
    );
}

#[test]
fn an_import_review_carries_one_notion_draft_with_its_left_out_and_reshared_rows() {
    let tools = ai_tools::code_mode_tools();
    assert!(validate_draft(&tools, ReviewKind::Import, &json!({"source": "notion"})).is_ok());
    assert!(
        validate_draft(
            &tools,
            ReviewKind::Import,
            &json!({"source": "notion", "excluded": ["01a15623-f76d-7ea0-955d-a9ecb91a520e"]})
        )
        .is_ok()
    );
    assert!(
        validate_draft(
            &tools,
            ReviewKind::Import,
            &json!({
                "source": "notion",
                "excluded": [],
                "shared": ["01a15623-f76d-7ea0-955d-a9ecb91a520e"],
                "personal": ["01a15623-f76d-7ea0-955d-a9ecb91a520f"]
            })
        )
        .is_ok(),
        "the owner's sharing changes travel with the draft"
    );
    for draft in [
        json!({"source": "linear"}),
        json!({"source": "notion", "excluded": ["not a uuid"]}),
        json!({"source": "notion", "personal": ["not a uuid"]}),
        json!({"source": "notion", "write": "everything"}),
        json!({}),
    ] {
        assert!(
            validate_draft(&tools, ReviewKind::Import, &draft).is_err(),
            "{draft}"
        );
    }
}
