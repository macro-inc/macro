use super::*;

fn line(value: Value) -> String {
    value.to_string()
}

#[test]
fn a_tool_turn_streams_calls_results_and_its_end() {
    let mut log = ClaudeLog::default();
    let call = line(json!({
        "type": "assistant", "uuid": "u1",
        "message": {"stop_reason": "tool_use", "content": [
            {"type": "thinking", "thinking": "need a file"},
            {"type": "tool_use", "id": "toolu_1", "name": "Write", "input": {"file_path": "/r/todo.html", "content": "<html>"}}
        ]}
    }));
    assert_eq!(
        log.entry(&call),
        [
            LogEvent::Update(json!({
                "sessionUpdate": "agent_thought_chunk",
                "content": {"type": "text", "text": "need a file"},
            })),
            LogEvent::Update(json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "toolu_1",
                "title": "Write /r/todo.html",
                "kind": "edit",
                "status": "in_progress",
                "rawInput": {"file_path": "/r/todo.html", "content": "<html>"},
                "_meta": {"claudeCode": {"toolName": "Write"}},
            })),
        ]
    );
    // Reopening the transcript must not replay a line.
    assert!(log.entry(&call).is_empty());

    let result = line(json!({
        "type": "user", "uuid": "u2",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "File created"}]}
    }));
    assert_eq!(
        log.entry(&result),
        [LogEvent::Update(json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "toolu_1",
            "status": "completed",
            "content": [{"type": "content", "content": {"type": "text", "text": "File created"}}],
        }))]
    );

    let done = line(json!({
        "type": "assistant", "uuid": "u3",
        "message": {"stop_reason": "end_turn", "content": [{"type": "text", "text": "Built it."}]}
    }));
    assert_eq!(
        log.entry(&done),
        [
            LogEvent::Update(json!({
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "Built it."},
            })),
            LogEvent::TurnEnded("end_turn"),
        ]
    );
}

#[test]
fn failed_tools_and_block_results_are_reported() {
    let mut log = ClaudeLog::default();
    let result = line(json!({
        "type": "user", "uuid": "u",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "t", "is_error": true,
            "content": [{"type": "text", "text": "exit 1"}, {"type": "text", "text": "boom"}]}]}
    }));
    assert_eq!(
        log.entry(&result),
        [LogEvent::Update(json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "t",
            "status": "failed",
            "content": [{"type": "content", "content": {"type": "text", "text": "exit 1\nboom"}}],
        }))]
    );
}

#[test]
fn bookkeeping_and_sidechains_are_skipped() {
    let mut log = ClaudeLog::default();
    for entry in [
        json!({"type": "attachment", "uuid": "b"}),
        json!({"type": "ai-title", "aiTitle": "Todo app"}),
        json!({"type": "assistant", "uuid": "c", "isSidechain": true,
            "message": {"stop_reason": "end_turn", "content": [{"type": "text", "text": "sub"}]}}),
    ] {
        assert!(log.entry(&line(entry)).is_empty());
    }
    assert!(log.entry("not json").is_empty());
}

#[test]
fn bash_calls_are_titled_by_their_description() {
    assert_eq!(
        tool_title(
            "Bash",
            &json!({"command": "npm test", "description": "Run tests"})
        ),
        "Bash Run tests"
    );
    assert_eq!(tool_title("Bash", &json!({"command": "ls"})), "Bash ls");
    assert_eq!(tool_title("TodoWrite", &json!({})), "TodoWrite");
}

#[test]
fn conversation_snapshot() {
    let mut fold = ClaudeLog::default();
    let events: Vec<_> = include_str!("../fixtures/conversation.jsonl")
        .lines()
        .flat_map(|line| fold.entry(line))
        .collect();
    insta::assert_json_snapshot!(events);
}

#[test]
fn malformed_records_do_not_poison_following_records() {
    let mut fold = ClaudeLog::default();
    assert!(fold.entry("{").is_empty());
    let actual: Vec<_> = include_str!("../fixtures/conversation.jsonl")
        .lines()
        .flat_map(|line| fold.entry(line))
        .collect();
    let mut fresh = ClaudeLog::default();
    let expected: Vec<_> = include_str!("../fixtures/conversation.jsonl")
        .lines()
        .flat_map(|line| fresh.entry(line))
        .collect();
    assert_eq!(actual, expected);
}

#[test]
fn api_messages_snapshot() {
    let mut native = ClaudeLog::default();
    let mut wire = String::new();
    for event in include_str!("../fixtures/conversation.jsonl")
        .lines()
        .flat_map(|line| native.entry(line))
    {
        let (method, params) = match event {
            LogEvent::Update(update) => {
                ("session/update", json!({"sessionId":"s", "update":update}))
            }
            LogEvent::TurnEnded(stop) => (
                "_session/turn_complete",
                json!({"sessionId":"s", "outcome":{"kind":if stop == "cancelled" {"cancelled"} else {"finished"}}}),
            ),
        };
        wire.push_str(&json!({"direction":"to_server", "content":{"type":"acp", "jsonrpc":"2.0", "method":method, "params":params}}).to_string());
        wire.push('\n');
    }
    let messages = agent_fold::domain::fold::fold(agent_fold::testing::parse_log(&wire));
    assert!(messages.len() >= 3, "native turns must reach API messages");
    insta::assert_json_snapshot!(messages);
}
