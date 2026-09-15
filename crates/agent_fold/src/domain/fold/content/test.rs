use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::log::AgentSessionLog;
use crate::domain::model::{FoldEvent, MessagePart};
use crate::domain::ports::FoldMachine;
use crate::testing::parse_log;
use agent_runtime_protocol::domain::text_replace::text_replace_meta;
use serde_json::{Value, json};

fn frame(direction: &str, mut body: Value) -> AgentSessionLog {
    body["type"] = json!("acp");
    body["jsonrpc"] = json!("2.0");
    parse_log(&json!({"direction":direction,"content":body}).to_string())
        .pop()
        .unwrap()
}

fn update(mut body: Value) -> AgentSessionLog {
    if body.get("sessionUpdate").is_none() {
        body["sessionUpdate"] = json!("agent_message_chunk");
    }
    frame(
        "to_server",
        json!({"method":"session/update","params":{"sessionId":"s","update":body}}),
    )
}

fn snapshot(id: &str, text: &str) -> AgentSessionLog {
    update(json!({"content":{"type":"text","text":text},"_meta":text_replace_meta(id)}))
}

fn text(part: &MessagePart) -> &str {
    match part {
        MessagePart::Text { text } => text,
        other => panic!("expected text, got {other:?}"),
    }
}

#[test]
fn snapshots_correct_in_place_across_tools_and_keep_unkeyed_text_separate() {
    let log = [
        snapshot("a", "provisional"),
        update(
            json!({"sessionUpdate":"tool_call","toolCallId":"t","title":"Tool","status":"in_progress"}),
        ),
        snapshot("b", "later"),
        snapshot("a", "corrected"),
        snapshot("b", "later"),
        update(json!({"content":{"type":"text","text":"append"}})),
        snapshot("b", ""),
        snapshot("a", "correction after clear"),
    ];
    let mut machine = FoldMachineImpl::new();
    let mut visible = vec![];
    for (i, entry) in log.iter().enumerate() {
        let events = machine.push(entry.clone());
        if i == 4 {
            assert!(
                events.is_empty(),
                "identical snapshot must not emit an update"
            );
        }
        for event in events {
            match event {
                FoldEvent::NewMessage(message) => visible.push(message.into_owned()),
                FoldEvent::MessageUpdate(message) => {
                    let position = visible
                        .iter()
                        .position(|old| old.id() == message.id())
                        .unwrap();
                    visible[position] = message.into_owned();
                }
                FoldEvent::MessagesReplaced(messages) => visible = messages.into_owned(),
                FoldEvent::MetadataUpdated(_) => {}
            }
        }
        assert_eq!(visible, fold(log[..=i].iter().cloned()));
    }
    let parts = &visible[0].parts;
    assert_eq!(parts.len(), 4);
    assert_eq!(text(&parts[0]), "correction after clear");
    assert!(!matches!(parts[1], MessagePart::Text { .. }));
    assert_eq!(text(&parts[2]), "");
    assert_eq!(text(&parts[3]), "append");
}

#[test]
fn keys_are_turn_local_and_replay_preserves_keys_for_live_corrections() {
    let replay = vec![
        frame(
            "to_runtime",
            json!({"id":1,"method":"session/load","params":{"sessionId":"s","cwd":"/","mcpServers":[]}}),
        ),
        update(
            json!({"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"first"}}),
        ),
        snapshot("same", "first answer"),
        update(
            json!({"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"second"}}),
        ),
        snapshot("same", "second provisional"),
        snapshot("same", "second answer"),
        frame("to_server", json!({"id":1,"result":{}})),
    ];
    let mut log = replay.clone();
    log.extend(replay);
    log.push(snapshot("same", "live correction"));
    let messages = fold(log);
    assert_eq!(messages.len(), 4);
    assert_eq!(text(&messages[1].parts[0]), "first answer");
    assert_eq!(text(&messages[3].parts[0]), "live correction");
    assert_eq!(messages[3].parts.len(), 1);
}

#[test]
fn prompt_completion_resets_keys_and_first_empty_snapshot_reserves_position() {
    let messages = fold(vec![
        snapshot("a", "old"),
        frame(
            "to_server",
            json!({"id":0,"result":{"stopReason":"end_turn"}}),
        ),
        snapshot("a", ""),
        snapshot("b", "later"),
        snapshot("a", "new"),
    ]);
    assert_eq!(messages.len(), 2);
    assert_eq!(text(&messages[0].parts[0]), "old");
    assert_eq!(text(&messages[1].parts[0]), "new");
    assert_eq!(text(&messages[1].parts[1]), "later");
}
