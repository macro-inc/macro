use super::*;
use serde_json::json;

fn association(turn: &str, url: &str) -> Value {
    json!({"assistant_turn_id":turn,"pull_request":{"url":url,"state":"future_status","merged":false}})
}
fn snapshot(body: &Value) -> TaskSnapshot {
    TaskSnapshot::from_native(&CloudId::new("task-one".into()).unwrap(), &body.to_string()).unwrap()
}

#[test]
fn only_structured_external_associations_create_pr_links() {
    let body = json!({"task":{"id":"task-one"},"current_assistant_turn":{"id":"task-one~turn-1","turn_status":"completed","output_items":[
        {"type":"pr","url":"https://github.com/owner/repo/pull/9","diff":"proposal"},
        {"type":"message","content":[{"content_type":"text","text":"Created https://github.com/owner/repo/pull/9"}]}
    ]}});
    let projected = snapshot(&body);
    assert!(projected.pull_requests.is_empty());
    assert_eq!(projected.turns[0].messages.len(), 1);
    assert!(projected.turns[0].has_diff);
}

#[test]
fn task_and_turn_reads_preserve_all_turn_associations_and_raw_native_input() {
    let task = json!({"id":"task-one","external_pull_requests":[
        association("task-one~turn-1","https://github.com/owner/repo/pull/9"),
        association("task-one~turn-2","https://github.com/other/repo/pull/10")
    ]});
    for field in ["current_assistant_turn", "turn"] {
        let body =
            json!({"task":task,field:{"id":"task-one~turn-2","turn_status":"unknown_status"}});
        let projected = snapshot(&body);
        assert_eq!(projected.pull_requests.len(), 2);
        assert_eq!(
            projected.pull_requests[0].assistant_turn_id.as_str(),
            "task-one~turn-1"
        );
        assert_eq!(
            projected.pull_requests[1].url,
            "https://github.com/other/repo/pull/10"
        );
        assert_eq!(
            projected.assistant_status.as_deref(),
            Some("unknown_status")
        );
        assert!(!projected.terminal());
        assert_eq!(projected.native.as_deref(), Some(body.to_string().as_str()));
    }
}

#[test]
fn malformed_associations_do_not_break_transcript_or_invent_current_turn_binding() {
    let mut associations = vec![
        association("bad/turn", "https://github.com/owner/repo/pull/9"),
        json!({"pull_request":{"url":"https://github.com/owner/repo/pull/9"}}),
    ];
    for url in [
        "http://github.com/owner/repo/pull/9",
        "https://github.com.evil/owner/repo/pull/9",
        "https://token@github.com/owner/repo/pull/9",
        "https://github.com/owner/repo/pull/9?secret=x",
        "https://github.com/owner/repo/pull/9#x",
        "https://github.com/owner/repo/issues/9",
        "https://github.com/owner/repo/pull/0",
        "https://github.com/owner/repo/pull/-9",
        "https://github.com/owner/repo/pull/9/",
        "https://github.com/owner/%72epo/pull/9",
    ] {
        associations.push(association("turn-1", url));
    }
    let body = json!({"task":{"id":"task-one","external_pull_requests":associations},"turn":{"id":"valid-turn","turn_status":"completed"}});
    let projected = snapshot(&body);
    assert!(projected.pull_requests.is_empty());
    assert!(projected.terminal());
    assert_eq!(projected.turns[0].id.as_deref(), Some("valid-turn"));
}
