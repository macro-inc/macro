use super::*;
use serde_json::json;
#[test]
fn completed_messages_do_not_duplicate_deltas() {
    let mut state = HashMap::new();
    let mut updates = Vec::new();
    for (method, params) in [
        (
            "item/agentMessage/delta",
            json!({"itemId":"m","delta":"hello"}),
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
            json!({"itemId":"m","delta":" world"}),
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
fn unsupported_prompt_content_is_rejected() {
    let blocks =
        serde_json::from_value(json!([{"type":"image","data":"AA==","mimeType":"image/png"}]))
            .unwrap();
    assert!(prompt_text(blocks).is_err());
}
