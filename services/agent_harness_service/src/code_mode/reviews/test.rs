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

fn notification_fixture(kind: ReviewKind, draft: Value) -> ReviewRecord {
    ReviewRecord {
        id: ReviewId(macro_uuid::generate_uuid_v7()),
        session_id: AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        execution_id: None,
        presented_at: Some(1),
        kind,
        title: "Fixture review".into(),
        revision: 1,
        updated_at: 1,
        items: vec![ReviewItem {
            id: macro_uuid::generate_uuid_v7(),
            draft: draft.clone(),
            status: ReviewItemStatus::Completed,
            result: Some(draft),
            error: None,
        }],
        notification_id: Some(macro_uuid::generate_uuid_v7()),
        notification_attempt_at: None,
    }
}

#[test]
fn notifications_keep_action_details_on_review() {
    for (kind, draft, expected) in [
        (
            ReviewKind::Email,
            json!({"subject":"Project update", "body":"private body"}),
            "Project update",
        ),
        (
            ReviewKind::Calendar,
            json!({"title":"Planning", "description":"private notes"}),
            "Planning",
        ),
    ] {
        let mut record = notification_fixture(kind, draft);
        record.items[0].result = Some(json!({"provider":"raw response omitted"}));
        record.items.push(ReviewItem {
            status: ReviewItemStatus::Unknown,
            ..record.items[0].clone()
        });
        let text = notification_summary(&record);
        assert!(!text.contains(expected));
        assert!(text.contains("1 completed; 1 outcome unconfirmed;"));
        assert!(text.contains("outcome unconfirmed"));
        assert!(text.contains("no further sending or scheduling is requested"));
        assert!(!text.contains("private"));
        assert!(!text.contains("provider"));
    }
}

#[test]
fn notifications_bound_unicode_stacks_and_preserve_the_saved_reference() {
    let mut record = notification_fixture(
        ReviewKind::Email,
        json!({"subject":"🙂".repeat(4000), "body":"é\n".repeat(4000)}),
    );
    record.title = "Long\nreview 🙂".repeat(4000);
    record.items = vec![record.items[0].clone(); 100];
    let text = notification_summary(&record);
    assert!(text.len() <= 8 * 1024);
    assert!(text.contains("Review updated: Long review 🙂"));
    assert!(text.contains("100 completed;"));
    assert!(text.contains(&record.id.0.to_string()));
}

#[test]
fn hundred_uncertain_actions_produce_one_bounded_context_summary() {
    let mut record = notification_fixture(ReviewKind::Email, json!({"subject":"Hi #1"}));
    record.items[0].status = ReviewItemStatus::Unknown;
    record.items = vec![record.items[0].clone(); 100];
    let action = agent_runtime_protocol::domain::action::AgentAction::context_prompt(
        notification_summary(&record),
    );
    let agent_runtime_protocol::domain::action::AgentAction::Prompt(prompt) = action else {
        panic!("context travels through the normal prompt queue");
    };
    assert!(prompt.prompt.is_empty());
    let context = prompt.private_context.unwrap();
    assert!(context.contains("100 outcome unconfirmed;"));
    assert!(context.contains(&record.id.0.to_string()));
    assert!(!context.contains("Hi #1"));
    assert!(context.len() < 1024);
}
