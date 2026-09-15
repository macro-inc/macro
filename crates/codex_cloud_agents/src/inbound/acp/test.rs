use super::*;
use serde_json::json;
#[test]
fn completed_messages_ignore_unordered_deltas_and_repeated_completions() {
    let mut state = HashMap::new();
    let mut updates = Vec::new();
    for (method, params) in [
        (
            "item/agentMessage/delta",
            json!({"itemId":"m","delta":" world"}),
        ),
        (
            "item/completed",
            json!({"item":{"id":"m","type":"agentMessage","text":"hello world"}}),
        ),
        (
            "item/completed",
            json!({"item":{"id":"m","type":"agentMessage","text":"hello world"}}),
        ),
        (
            "item/agentMessage/delta",
            json!({"itemId":"m","delta":"hello"}),
        ),
        (
            "item/reasoning/summaryTextDelta",
            json!({"delta":"thinking"}),
        ),
    ] {
        updates.extend(project(
            &CloudEvent {
                id: String::new(),
                method: method.into(),
                params,
            },
            &mut state,
        ));
    }
    insta::assert_json_snapshot!(updates);
}

#[test]
fn distinct_complete_messages_have_markdown_boundaries_and_reset_on_new_turn() {
    let mut state = HashMap::new();
    let mut updates = Vec::new();
    for (method, params) in [
        (
            "item/completed",
            json!({"item":{"id":"m1","type":"agentMessage","text":"## Hello"}}),
        ),
        (
            "item/completed",
            json!({"item":{"id":"m2","type":"agentMessage","text":"- A list"}}),
        ),
        ("user/message", json!({"text":"Next question"})),
        (
            "item/completed",
            json!({"item":{"id":"m3","type":"agentMessage","text":"New answer"}}),
        ),
    ] {
        updates.extend(project(
            &CloudEvent {
                id: String::new(),
                method: method.into(),
                params,
            },
            &mut state,
        ));
    }
    insta::assert_json_snapshot!(updates);
}
#[test]
fn unsupported_prompt_content_is_rejected() {
    let blocks =
        serde_json::from_value(json!([{"type":"image","data":"AA==","mimeType":"image/png"}]))
            .unwrap();
    assert!(prompt_text(blocks).is_err());
}
