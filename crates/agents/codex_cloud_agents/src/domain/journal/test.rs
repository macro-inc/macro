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
    assert_eq!(reduce(&entries).len(), 2);
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
            .filter(|event| event.method == "item/completed")
            .count(),
        1
    );
    assert_eq!(output.last().unwrap().method, "session/turn_complete");
}

#[test]
fn missing_and_reordered_deltas_never_corrupt_completed_message_live_or_replay() {
    let inputs = vec![
        JournalInput::HistoryComplete,
        native(
            "middle",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg", "delta":" is"}),
        ),
        native(
            "end",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg", "delta":"Codex."}),
        ),
        native(
            "complete",
            "item/completed",
            serde_json::json!({"item":{"id":"msg","type":"agentMessage","text":"My name is Codex."}}),
        ),
        native(
            "start",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg", "delta":"My name"}),
        ),
        native(
            "middle",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg", "delta":" is"}),
        ),
        native(
            "complete",
            "item/completed",
            serde_json::json!({"item":{"id":"msg","type":"agentMessage","text":"My name is Codex."}}),
        ),
    ];
    let entries: Vec<_> = inputs
        .into_iter()
        .enumerate()
        .map(|(index, input)| entry(index as i64 + 1, input))
        .collect();
    let output = reduce(&entries);
    assert_eq!(output.len(), 1);
    assert_eq!(output[0]["params"]["item"]["text"], "My name is Codex.");
    let replay: Vec<JournalEntry> =
        serde_json::from_str(&serde_json::to_string(&entries).unwrap()).unwrap();
    assert_eq!(reduce(&replay), output);
}

#[test]
fn terminal_poll_preserves_multiple_equal_messages_once_across_repeated_reads() {
    let snapshot = TaskSnapshot {
        pull_requests: vec![],
        native: None,
        task_id: super::super::cloud::CloudId::new("task-test".into()).unwrap(),
        title: None,
        assistant_status: Some("completed".into()),
        turns: vec![super::super::cloud::TurnSnapshot {
            source: "current_assistant_turn".into(),
            id: Some("turn~test".into()),
            messages: vec![
                "First message".into(),
                "Same message".into(),
                "Same message".into(),
            ],
            output_types: vec![],
            has_diff: false,
        }],
    };
    let inputs = vec![
        JournalInput::HistoryComplete,
        native(
            "fragment",
            "item/agentMessage/delta",
            serde_json::json!({"itemId":"msg","delta":" message"}),
        ),
        JournalInput::Poll {
            snapshot: snapshot.clone(),
            native: None,
        },
        JournalInput::Terminal("completed".into()),
    ];
    let mut machine = ReplayMachine::default();
    for (index, input) in inputs.into_iter().enumerate() {
        assert!(
            machine
                .push(&entry(index as i64 + 1, input))
                .unwrap()
                .is_empty()
        );
    }
    let output = machine.finish();
    assert_eq!(output.len(), 4);
    assert_eq!(output[0].params["item"]["text"], "First message");
    assert_eq!(output[1].params["item"]["text"], "Same message");
    assert_eq!(output[2].params["item"]["text"], "Same message");
    assert_ne!(
        output[1].params["item"]["id"],
        output[2].params["item"]["id"]
    );
    machine
        .push(&entry(
            5,
            JournalInput::Poll {
                snapshot,
                native: None,
            },
        ))
        .unwrap();
    assert!(machine.finish().is_empty());
}

#[test]
fn recorded_two_turn_conversation_has_identical_complete_live_and_replayed_answers() {
    let entries: Vec<JournalEntry> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/missing_live_deltas.json"
    ))
    .unwrap();
    let mut live = ReplayMachine::default();
    let mut replay = ReplayMachine::default();
    let mut live_output = Vec::new();
    let mut replay_output = Vec::new();
    for entry in &entries {
        live_output.extend(live.push(entry).unwrap());
        if matches!(entry.input, JournalInput::Terminal(_)) {
            live_output.extend(live.finish());
        }
        replay_output.extend(replay.push(entry).unwrap());
    }
    replay_output.extend(replay.finish());
    let answers = |events: &[CloudEvent]| {
        events
            .iter()
            .filter(|event| {
                event.method == "item/completed" && event.params["item"]["type"] == "agentMessage"
            })
            .map(|event| event.params["item"]["text"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    let actual = answers(&live_output);
    assert_eq!(actual, answers(&replay_output));
    assert_eq!(actual.len(), 3);
    assert_eq!(actual[0].chars().count(), 327);
    assert_eq!(actual[1].chars().count(), 688);
    assert_eq!(
        actual[2],
        "My name is **Codex**. I’m an AI coding assistant created by OpenAI."
    );
    for output in [&live_output, &replay_output] {
        assert!(
            !output
                .iter()
                .any(|event| event.method == "item/agentMessage/delta")
        );
        assert_eq!(
            output
                .iter()
                .filter(|event| event.method == "session/turn_complete")
                .count(),
            2
        );
    }
}

#[test]
fn cancelled_and_failed_turns_do_not_publish_unverified_fragments() {
    for status in ["cancelled", "failed"] {
        let mut machine = ReplayMachine::default();
        for (index, input) in [
            JournalInput::HistoryComplete,
            native(
                "fragment",
                "item/agentMessage/delta",
                serde_json::json!({"itemId":"msg","delta":" middle of a sentence"}),
            ),
            JournalInput::Terminal(status.into()),
        ]
        .into_iter()
        .enumerate()
        {
            assert!(
                machine
                    .push(&entry(index as i64 + 1, input))
                    .unwrap()
                    .is_empty()
            );
        }
        let output = machine.finish();
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].method, "session/turn_complete");
        assert_eq!(output[0].params["status"], status);
    }
}

#[test]
fn native_completion_and_fragmented_poll_text_cover_each_other_without_duplicates() {
    let snapshot = TaskSnapshot {
        pull_requests: vec![],
        native: None,
        task_id: super::super::cloud::CloudId::new("task-test".into()).unwrap(),
        title: None,
        assistant_status: Some("completed".into()),
        turns: vec![super::super::cloud::TurnSnapshot {
            source: "current_assistant_turn".into(),
            id: Some("turn~test".into()),
            messages: vec!["Hello ".into(), "world".into()],
            output_types: vec![],
            has_diff: false,
        }],
    };
    let completion = native(
        "complete",
        "item/completed",
        serde_json::json!({
            "item":{"id":"msg","type":"agentMessage","text":"Hello world"}
        }),
    );
    for poll_first in [true, false] {
        let mut machine = ReplayMachine::default();
        machine
            .push(&entry(1, JournalInput::HistoryComplete))
            .unwrap();
        let mut sequence = 2;
        if !poll_first {
            assert_eq!(
                machine
                    .push(&entry(sequence, completion.clone()))
                    .unwrap()
                    .len(),
                1
            );
            sequence += 1;
        }
        machine
            .push(&entry(
                sequence,
                JournalInput::Poll {
                    snapshot: snapshot.clone(),
                    native: None,
                },
            ))
            .unwrap();
        machine
            .push(&entry(
                sequence + 1,
                JournalInput::Terminal("completed".into()),
            ))
            .unwrap();
        let output = machine.finish();
        assert_eq!(output.len(), if poll_first { 3 } else { 1 });
        if poll_first {
            assert!(
                machine
                    .push(&entry(sequence + 2, completion.clone()))
                    .unwrap()
                    .is_empty()
            );
        }
        assert!(machine.finish().is_empty());
    }
}
