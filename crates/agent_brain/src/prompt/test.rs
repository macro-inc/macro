use serde_json::json;

use super::*;

#[test]
fn builds_instructions_batch_and_history() {
    let prompt = TurnPrompt::new("You are Ada.\n")
        .messages(&[json!({"id": "m1"}), json!({"id": "m2"})])
        .unwrap()
        .history::<serde_json::Value>(&[])
        .unwrap()
        .build();

    assert_eq!(
        prompt,
        format!(
            "You are Ada.\n\n{MESSAGES_HEADING}\n\n{{\"id\":\"m1\"}}\n{{\"id\":\"m2\"}}\n\n{HISTORY_HEADING}\n\n(none)\n"
        )
    );
}
