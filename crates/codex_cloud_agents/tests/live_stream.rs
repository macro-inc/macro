//! Actual cloud ACP snapshots, including the observed non-prefix final correction.
use agent_client_protocol::RawJsonRpcMessage;
use agent_fold::domain::{
    fold::{FoldMachineImpl, fold},
    log::{AgentSessionId, AgentSessionLog, Message},
    model::{FoldEvent, FoldedMessage, MessagePart, StopReason},
    ports::FoldMachine as _,
};
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToRuntimeMessage, ToServerMessage};
use serde_json::Value;

fn fixture() -> Vec<(AgentSessionLog, Option<String>)> {
    include_str!("fixtures/live_text_replacement.jsonl")
        .lines()
        .map(|line| {
            let row: Value = serde_json::from_str(line).unwrap();
            let text = row["frame"]["params"]["update"]["content"]["text"]
                .as_str()
                .map(str::to_owned);
            let frame: RawJsonRpcMessage = serde_json::from_value(row["frame"].clone()).unwrap();
            let content = match row["direction"].as_str().unwrap() {
                "to_runtime" => Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(frame))),
                "to_server" => Message::ToServer(ToServerMessage::Acp(AcpMessage(frame))),
                other => panic!("unexpected direction: {other}"),
            };
            (
                AgentSessionLog {
                    agent_session_id: AgentSessionId::new_from_uuid(uuid::Uuid::from_u128(1)),
                    user_id: None,
                    content,
                },
                text,
            )
        })
        .collect()
}

fn agent_text(messages: &[FoldedMessage]) -> &str {
    assert_eq!(messages.len(), 2, "one user and one agent message");
    assert_eq!(
        messages[1].parts.len(),
        1,
        "snapshots share a single text part"
    );
    match &messages[1].parts[0] {
        MessagePart::Text { text } => text,
        other => panic!("unexpected agent part: {other:?}"),
    }
}

#[test]
fn actual_live_tokens_and_final_correction_fold_identically_at_every_prefix() {
    let recording = fixture();
    let mut machine = FoldMachineImpl::new();
    let mut visible: Vec<FoldedMessage> = Vec::new();
    let mut prior = String::new();
    let mut text_updates = 0;
    let mut corrections = 0;
    for (index, (entry, expected)) in recording.iter().enumerate() {
        for event in machine.push(entry.clone()) {
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
        assert_eq!(visible, machine.messages());
        assert_eq!(
            visible,
            fold(recording[..=index].iter().map(|(entry, _)| entry.clone()))
        );
        if let Some(expected) = expected {
            text_updates += 1;
            assert_eq!(
                agent_text(&visible),
                expected,
                "recorded text update {text_updates}"
            );
            assert_eq!(
                visible[1].stop, None,
                "text must be visible before completion"
            );
            if !expected.starts_with(&prior) {
                corrections += 1;
                assert_eq!(
                    text_updates, 236,
                    "last snapshot corrects the real provisional stream"
                );
                assert_eq!(prior.chars().count(), 1007);
                assert_eq!(expected.chars().count(), 1357);
            }
            prior.clone_from(expected);
        }
    }
    assert_eq!(text_updates, 236);
    assert_eq!(corrections, 1);
    let final_text = agent_text(&visible);
    assert_eq!(final_text, prior);
    assert_eq!(final_text.matches("## What You’ll Need").count(), 1);
    assert_eq!(final_text.matches("## Brewing the Tea").count(), 1);
    assert!(final_text.ends_with("Enjoy it while pleasantly warm."));
    assert_eq!(visible[1].stop, Some(StopReason::EndTurn));
}
