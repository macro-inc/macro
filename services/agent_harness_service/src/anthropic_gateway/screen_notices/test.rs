use chrono::{TimeZone as _, Utc};
use computer_screen::domain::models::{AgentNotice, Driver, NoticeName};
use macro_user_id::user_id::MacroUserIdStr;

use super::insert;

fn hand_back() -> AgentNotice {
    AgentNotice {
        name: NoticeName::HandBack,
        driver: Driver {
            user_id: MacroUserIdStr::try_from("macro|alice@example.com".to_owned()).unwrap(),
            name: Some("Alice".to_owned()),
        },
        started_at: Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap(),
        ended_at: Some(Utc.with_ymd_and_hms(2026, 11, 20, 10, 2, 0).unwrap()),
        note: Some("signed you in".to_owned()),
    }
}

#[test]
fn notices_go_first_in_the_last_user_message() {
    let mut request = serde_json::json!({
        "model": "claude-sonnet-5-5",
        "messages": [
            { "role": "user", "content": "first" },
            { "role": "assistant", "content": "ok" },
            { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "done" }] },
        ],
    });

    insert(&mut request, &[hand_back()]);

    assert_eq!(
        request["messages"][2]["content"],
        serde_json::json!([
            {
                "type": "text",
                "text": "<macro-runtime-notice>{\"name\":\"computer.screen.handBack\",\"driver\":{\"userId\":\"macro|alice@example.com\",\"name\":\"Alice\"},\"startedAt\":\"2026-11-20T10:00:00Z\",\"endedAt\":\"2026-11-20T10:02:00Z\",\"note\":\"signed you in\"}</macro-runtime-notice>",
            },
            { "type": "tool_result", "tool_use_id": "t1", "content": "done" },
        ])
    );
    assert_eq!(request["messages"][0]["content"], "first");
}

#[test]
fn a_string_message_becomes_blocks() {
    let mut request = serde_json::json!({ "messages": [{ "role": "user", "content": "hi" }] });

    insert(&mut request, &[hand_back()]);

    let content = request["messages"][0]["content"].as_array().unwrap();
    assert_eq!(content.len(), 2);
    assert_eq!(
        content[1],
        serde_json::json!({ "type": "text", "text": "hi" })
    );
}
