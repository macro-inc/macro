use super::*;

fn event(payload: Value) -> String {
    json!({"timestamp": "2026-09-27T05:45:49Z", "type": "event_msg", "payload": payload})
        .to_string()
}

fn completed(item: Value) -> String {
    event(json!({"type": "item_completed", "thread_id": "t", "turn_id": "u", "item": item}))
}

#[test]
fn a_command_turn_streams_messages_commands_and_its_end() {
    let mut log = CodexLog::default();
    assert!(
        log.entry(&event(json!({"type": "task_started"})))
            .is_empty()
    );
    assert_eq!(
        log.entry(&completed(json!({
            "type": "AgentMessage", "id": "m1", "phase": "commentary",
            "content": [{"type": "Text", "text": "I'll create hello.txt."}]
        }))),
        [LogEvent::Update(json!({
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "I'll create hello.txt."},
        }))]
    );
    let command = completed(json!({
        "type": "CommandExecution", "id": "exec-1",
        "command": ["/bin/bash", "-lc", "cat hello.txt"],
        "parsed_cmd": [{"type": "read", "cmd": "cat hello.txt", "name": "hello.txt"}],
        "status": "completed", "aggregated_output": "hi", "exit_code": 0
    }));
    assert_eq!(
        log.entry(&command),
        [LogEvent::Update(json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "exec-1",
            "title": "Run cat hello.txt",
            "kind": "read",
            "status": "completed",
            "rawInput": {"command": "cat hello.txt"},
            "content": [{"type": "content", "content": {"type": "text", "text": "hi"}}],
        }))]
    );
    // A reopened rollout does not replay an item.
    assert!(log.entry(&command).is_empty());
    assert_eq!(
        log.entry(&event(
            json!({"type": "task_complete", "last_agent_message": "done"})
        )),
        [LogEvent::TurnEnded("end_turn")]
    );
}

#[test]
fn failed_multiline_commands_are_clipped_and_marked() {
    let mut log = CodexLog::default();
    log.entry(&event(json!({"type": "task_started"})));
    let events = log.entry(&completed(json!({
        "type": "CommandExecution", "id": "exec-2",
        "command": ["/bin/bash", "-lc", "npm test\necho done"],
        "parsed_cmd": [{"type": "unknown", "cmd": "npm test"}],
        "status": "completed", "aggregated_output": "", "exit_code": 1
    })));
    let [LogEvent::Update(update)] = events.as_slice() else {
        panic!("one update, got {events:?}");
    };
    assert_eq!(update["title"], "Run npm test…");
    assert_eq!(update["kind"], "execute");
    assert_eq!(update["status"], "failed");
    assert!(update.get("content").is_none());
}

#[test]
fn reasoning_file_changes_and_aborts_are_translated() {
    let mut log = CodexLog::default();
    log.entry(&event(json!({"type": "task_started"})));
    assert_eq!(
        log.entry(&completed(json!({"type": "Reasoning", "id": "r", "summary_text": ["Plan the app"], "raw_content": []}))),
        [LogEvent::Update(json!({
            "sessionUpdate": "agent_thought_chunk",
            "content": {"type": "text", "text": "Plan the app"},
        }))]
    );
    assert!(
        log.entry(&completed(
            json!({"type": "Reasoning", "id": "r2", "summary_text": [], "raw_content": []})
        ))
        .is_empty()
    );
    let events = log.entry(&completed(json!({
        "type": "FileChange", "id": "fc", "status": "completed",
        "changes": {"/r/index.html": {"type": "add"}, "/r/app.js": {"type": "add"}}
    })));
    let [LogEvent::Update(update)] = events.as_slice() else {
        panic!("one update, got {events:?}");
    };
    assert_eq!(update["kind"], "edit");
    assert!(update["title"].as_str().unwrap().starts_with("Edit /r/"));
    assert_eq!(
        log.entry(&event(
            json!({"type": "turn_aborted", "reason": "interrupted"})
        )),
        [LogEvent::TurnEnded("cancelled")]
    );
}

#[test]
fn bookkeeping_is_ignored() {
    let mut log = CodexLog::default();
    for line in [
        json!({"type": "session_meta", "payload": {"id": "s"}}).to_string(),
        json!({"type": "response_item", "payload": {"type": "message", "role": "assistant"}})
            .to_string(),
        event(json!({"type": "token_count"})),
        event(json!({"type": "task_started"})),
        "garbage".to_owned(),
    ] {
        assert!(log.entry(&line).is_empty());
    }
}

#[test]
fn conversation_snapshot() {
    let mut fold = CodexLog::default();
    let events: Vec<_> = include_str!("../fixtures/conversation.jsonl")
        .lines()
        .flat_map(|line| fold.entry(line))
        .collect();
    insta::assert_json_snapshot!(events);
}

#[test]
fn malformed_records_do_not_poison_following_records() {
    let mut fold = CodexLog::default();
    assert!(fold.entry("{").is_empty());
    let actual: Vec<_> = include_str!("../fixtures/conversation.jsonl")
        .lines()
        .flat_map(|line| fold.entry(line))
        .collect();
    let mut fresh = CodexLog::default();
    let expected: Vec<_> = include_str!("../fixtures/conversation.jsonl")
        .lines()
        .flat_map(|line| fresh.entry(line))
        .collect();
    assert_eq!(actual, expected);
}

/// The ACP lines macrod sends the harness for a rollout, as `herdr::acp_agent`
/// forwards them.
fn macrod_wire(rollout: &str) -> Vec<String> {
    let mut native = CodexLog::default();
    rollout
        .lines()
        .flat_map(|line| native.entry(line))
        .filter_map(|event| {
            let (method, params) = match event {
                LogEvent::ModelChanged(_) => return None,
                LogEvent::Update(update) => {
                    ("session/update", json!({"sessionId":"s", "update":update}))
                }
                // With no prompt waiting, macrod ends the late item's turn.
                LogEvent::LateUpdate(update) => {
                    return Some(vec![
                        json!({"direction":"to_server", "content":{"type":"acp", "jsonrpc":"2.0", "method":"session/update", "params":{"sessionId":"s", "update":update}}}).to_string(),
                        json!({"direction":"to_server", "content":{"type":"acp", "jsonrpc":"2.0", "method":"_session/turn_complete", "params":{"sessionId":"s", "outcome":{"kind":"finished"}}}}).to_string(),
                    ]);
                }
                LogEvent::TurnEnded(stop) => (
                    "_session/turn_complete",
                    json!({"sessionId":"s", "outcome":{"kind":if stop == "cancelled" {"cancelled"} else {"finished"}}}),
                ),
            };
            Some(vec![json!({"direction":"to_server", "content":{"type":"acp", "jsonrpc":"2.0", "method":method, "params":params}}).to_string()])
        })
        .flatten()
        .collect()
}

#[test]
fn api_messages_snapshot() {
    let wire = macrod_wire(include_str!("../fixtures/conversation.jsonl")).join("\n");
    let messages = agent_fold::domain::fold::fold(agent_fold::testing::parse_log(&wire));
    assert!(messages.len() >= 3, "native turns must reach API messages");
    insta::assert_json_snapshot!(messages);
}

#[test]
fn a_background_command_finishing_after_its_turn_leaves_the_session_idle() {
    use agent_fold::domain::lifecycle::LifecycleFold;
    use agent_fold::domain::model::TurnState;

    // Recorded: Codex logs a background command's completion after the
    // `task_complete` of the turn that started it.
    let wire = macrod_wire(include_str!("../fixtures/background_command.jsonl"));
    let mut observed = LifecycleFold::new();
    for entry in agent_fold::testing::parse_log(&wire.join("\n")) {
        let _ = observed.push(entry);
    }
    assert_eq!(observed.inner().metadata().turn, TurnState::Idle);

    // The same turn prompted from Macro: macrod answers the prompt when the
    // turn ends, and the late command arrives after that answer.
    let (turn, late) = wire.split_at(wire.len() - 2);
    let mut prompted = vec![
        json!({"direction":"to_runtime", "content":{"type":"acp", "jsonrpc":"2.0", "id":1, "method":"session/prompt", "params":{"sessionId":"s", "prompt":[{"type":"text", "text":"Make Enter move to the next row."}]}}}).to_string(),
    ];
    prompted.extend_from_slice(turn);
    prompted.push(
        json!({"direction":"to_server", "content":{"type":"acp", "jsonrpc":"2.0", "id":1, "result":{"stopReason":"end_turn"}}}).to_string(),
    );
    prompted.extend_from_slice(late);
    let mut fold = LifecycleFold::new();
    for entry in agent_fold::testing::parse_log(&prompted.join("\n")) {
        let _ = fold.push(entry);
    }
    assert_eq!(fold.inner().metadata().turn, TurnState::Idle);
}

#[test]
fn model_changes_snapshot() {
    let mut fold = CodexLog::default();
    let events: Vec<_> = include_str!("../fixtures/models.jsonl")
        .lines()
        .flat_map(|line| fold.entry(line))
        .collect();
    insta::assert_json_snapshot!(events);
}
