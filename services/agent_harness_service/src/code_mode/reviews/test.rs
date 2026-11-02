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
fn an_import_review_accepts_each_workspace_source_and_preserves_owner_choices() {
    let tools = ai_tools::code_mode_tools();
    for source in ["notion", "linear", "jira"] {
        assert!(validate_draft(&tools, ReviewKind::Import, &json!({"source": source})).is_ok());
        assert!(
            validate_draft(
                &tools,
                ReviewKind::Import,
                &json!({
                    "source": source,
                    "excluded": ["01a15623-f76d-7ea0-955d-a9ecb91a520e"],
                    "shared": ["01a15623-f76d-7ea0-955d-a9ecb91a520f"],
                    "personal": ["01a15623-f76d-7ea0-955d-a9ecb91a5210"]
                })
            )
            .is_ok(),
            "owner choices remain valid for {source}"
        );
    }
    for draft in [
        json!({"source": "slack"}),
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
