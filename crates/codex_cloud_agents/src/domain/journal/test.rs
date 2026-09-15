use super::*;
use agent_client_protocol::schema::v1::{ContentBlock, TextContent};

fn entry(sequence: i64, input: JournalInput) -> JournalEntry {
    JournalEntry {
        sequence,
        turn: Some(TurnId::new("turn~test".into()).unwrap()),
        input,
    }
}
fn native(id: &str, method: &str, params: serde_json::Value) -> JournalInput {
    JournalInput::Native(NativeRecord::from_event(CloudEvent {
        id: id.into(),
        method: method.into(),
        params,
    }))
}
fn reduce(entries: &[JournalEntry]) -> Vec<serde_json::Value> {
    let mut machine = ReplayMachine::default();
    entries
        .iter()
        .flat_map(|entry| machine.push(entry).unwrap())
        .map(|event| serde_json::to_value(event).unwrap())
        .collect()
}
#[test]
fn live_and_serialized_replay_preserve_native_unknown_records_and_suppress_duplicate_output() {
    let inputs = vec![
        JournalInput::HistoryComplete,
        JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new("hello"))]),
        JournalInput::Native(NativeRecord {
            event: "future-event".into(),
            id: None,
            data: "{\"item_type\":\"unknown\",\"future\":{\"kept\":true}}".into(),
        }),
        native(
            "one",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg","delta":"hello"}),
        ),
        native(
            "one",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg","delta":"hello"}),
        ),
        native(
            "two",
            "item/completed",
            serde_json::json!({"item":{"id":"msg","type":"agentMessage","text":"hello"}}),
        ),
        JournalInput::TransportError("EOF".into()),
        JournalInput::RecoveryStarted,
    ];
    let entries: Vec<_> = inputs
        .into_iter()
        .enumerate()
        .map(|(index, input)| entry(index as i64 + 1, input))
        .collect();
    let encoded = serde_json::to_string(&entries).unwrap();
    assert!(encoded.contains("future-event"));
    let restored: Vec<JournalEntry> = serde_json::from_str(&encoded).unwrap();
    assert_eq!(reduce(&entries), reduce(&restored));
    assert_eq!(reduce(&entries).len(), 3);
}
#[test]
fn missing_history_and_sequence_gaps_fail_closed() {
    assert!(
        ReplayMachine::default()
            .push(&entry(1, JournalInput::RecoveryStarted))
            .is_err()
    );
    let mut machine = ReplayMachine::default();
    machine
        .push(&entry(1, JournalInput::HistoryComplete))
        .unwrap();
    assert!(
        machine
            .push(&entry(3, JournalInput::RecoveryStarted))
            .is_err()
    );
}
#[test]
fn completed_poll_fallback_is_emitted_once_across_repeated_recovery() {
    let snapshot = TaskSnapshot {
        pull_requests: vec![],
        native: None,
        task_id: super::super::cloud::CloudId::new("task-test".into()).unwrap(),
        title: None,
        assistant_status: Some("completed".into()),
        turns: vec![super::super::cloud::TurnSnapshot {
            source: "current_assistant_turn".into(),
            id: Some("turn~test".into()),
            messages: vec!["final output".into()],
            output_types: vec![],
            has_diff: false,
        }],
    };
    let mut machine = ReplayMachine::default();
    machine
        .push(&entry(1, JournalInput::HistoryComplete))
        .unwrap();
    machine
        .push(&entry(
            2,
            JournalInput::Poll {
                snapshot: snapshot.clone(),
                native: None,
            },
        ))
        .unwrap();
    assert!(
        machine
            .push(&entry(3, JournalInput::Terminal("completed".into())))
            .unwrap()
            .is_empty()
    );
    assert_eq!(machine.finish().len(), 2);
    machine
        .push(&entry(4, JournalInput::RecoveryStarted))
        .unwrap();
    machine
        .push(&entry(
            5,
            JournalInput::Poll {
                snapshot,
                native: None,
            },
        ))
        .unwrap();
    assert!(
        machine
            .push(&entry(6, JournalInput::Terminal("completed".into())))
            .unwrap()
            .is_empty()
    );
    assert!(machine.finish().is_empty());
}

#[test]
fn native_answer_recovered_after_snapshot_terminal_replaces_the_fallback() {
    let snapshot = TaskSnapshot {
        pull_requests: vec![],
        native: None,
        task_id: super::super::cloud::CloudId::new("task-test".into()).unwrap(),
        title: None,
        assistant_status: Some("completed".into()),
        turns: vec![super::super::cloud::TurnSnapshot {
            source: "current_assistant_turn".into(),
            id: Some("turn~test".into()),
            messages: vec!["answer".into()],
            output_types: vec![],
            has_diff: false,
        }],
    };
    let inputs = vec![
        JournalInput::HistoryComplete,
        JournalInput::Poll {
            snapshot,
            native: None,
        },
        JournalInput::Terminal("completed".into()),
        native(
            "late",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg","delta":"answer"}),
        ),
        JournalInput::Terminal("completed".into()),
    ];
    let mut machine = ReplayMachine::default();
    let mut output = Vec::new();
    for (index, input) in inputs.into_iter().enumerate() {
        output.extend(machine.push(&entry(index as i64 + 1, input)).unwrap());
    }
    output.extend(machine.finish());
    assert_eq!(
        output
            .iter()
            .filter(|event| event.method == "item/agentMessage/delta")
            .count(),
        1
    );
    assert_eq!(output.last().unwrap().method, "session/turn_complete");
}
