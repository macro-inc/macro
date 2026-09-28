use super::*;
use serde_json::json;

#[test]
fn reported_gitkeep_citation_is_markdown_in_native_and_poll_messages() {
    // Text transcribed from the user's rendered reply, not a provider recording.
    let body = include_str!("../../../tests/fixtures/reported_gitkeep_message.md");
    for id in ["native-message", "poll-message:0"] {
        let event = CloudEvent {
            id: "citation-example".into(),
            method: "item/completed".into(),
            params: json!({"item":{"id":id,"type":"agentMessage","text":body}}),
        };
        let mut state = HashMap::new();
        let updates = project(&event, &mut state);
        insta::assert_json_snapshot!("reported_gitkeep_citation", updates);
        assert!(project(&event, &mut state).is_empty());
        assert_eq!(event.params["item"]["text"], body, "raw text stays intact");
    }
}
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
