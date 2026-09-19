//! Shared live-request lifecycle, preserving each protocol's answer shape.

use serde_json::{Value, json};

use super::util::parse_log;
use crate::domain::fold::FoldMachineImpl;
use crate::domain::model::{
    AgentRequestId, FoldEvent, MessagePart, PendingInteraction, PermissionOutcome, TurnState,
};
use crate::domain::ports::FoldMachine;

fn push(machine: &mut FoldMachineImpl, direction: &str, frame: Value) -> bool {
    let mut content = frame;
    content["type"] = json!("acp");
    content["jsonrpc"] = json!("2.0");
    let line = json!({"direction": direction, "content": content}).to_string();
    machine
        .push(parse_log(&line).remove(0))
        .iter()
        .any(|event| matches!(event, FoldEvent::MetadataUpdated(_)))
}

fn permission(id: Value) -> Value {
    json!({"id": id, "method": "session/request_permission", "params": {
        "sessionId": "s", "toolCall": {"toolCallId": "tool"},
        "options": [{"optionId": "once", "name": "Allow once", "kind": "allow_once"}]
    }})
}

fn question(id: Value) -> Value {
    json!({"id": id, "method": "elicitation/create", "params": {
        "sessionId": "s", "mode": "form", "message": "Which colour?",
        "requestedSchema": {"type": "object", "properties": {}}
    }})
}

fn prompt(machine: &mut FoldMachineImpl, id: &str) {
    push(
        machine,
        "to_runtime",
        json!({"id": id, "method": "session/prompt", "params": {
            "sessionId": "s", "prompt": [{"type": "text", "text": "go"}]
        }}),
    );
}

#[test]
fn concurrent_requests_share_blocked_state_and_resolve_independently() {
    let mut machine = FoldMachineImpl::new();
    prompt(&mut machine, "p");
    assert!(push(&mut machine, "to_server", permission(json!(7))));
    assert!(push(&mut machine, "to_server", permission(json!("7"))));
    assert!(push(&mut machine, "to_server", question(json!(8))));
    assert_eq!(machine.metadata().pending_interactions.len(), 3);
    assert_eq!(machine.metadata().turn, TurnState::Blocked);

    assert!(push(
        &mut machine,
        "to_runtime",
        json!({"id": 7, "result": {"outcome": {"outcome": "selected", "optionId": "once"}}})
    ));
    assert_eq!(machine.metadata().pending_interactions.len(), 2);
    assert!(
        matches!(&machine.metadata().pending_interactions[0], PendingInteraction::Permission(pending) if pending.request_id == AgentRequestId::Str("7".into()))
    );
    assert_eq!(machine.metadata().turn, TurnState::Blocked);
    // Two requests for the same tool still resolve the correct transcript row.
    let permissions: Vec<_> = machine
        .messages()
        .iter()
        .flat_map(|message| message.parts.iter())
        .filter_map(|part| match part {
            MessagePart::Permission { outcome, .. } => Some(outcome),
            _ => None,
        })
        .collect();
    assert!(matches!(permissions[0], PermissionOutcome::Selected { .. }));
    assert_eq!(*permissions[1], PermissionOutcome::Pending);

    push(
        &mut machine,
        "to_runtime",
        json!({"id": 8, "result": {"action": "decline"}}),
    );
    assert_eq!(machine.metadata().turn, TurnState::Blocked);
    push(
        &mut machine,
        "to_runtime",
        json!({"id": "7", "result": {"outcome": {"outcome": "cancelled"}}}),
    );
    assert!(machine.metadata().pending_interactions.is_empty());
    assert_eq!(machine.metadata().turn, TurnState::Running);
}

#[test]
fn a_second_elicitation_does_not_replace_the_live_question_or_permissions() {
    let mut machine = FoldMachineImpl::new();
    prompt(&mut machine, "p");
    push(&mut machine, "to_server", permission(json!(1)));
    push(&mut machine, "to_server", question(json!(2)));
    push(&mut machine, "to_server", question(json!(3)));
    push(
        &mut machine,
        "to_runtime",
        json!({"id": 3, "error": {"code": -32602, "message": "one elicitation at a time"}}),
    );
    assert_eq!(machine.metadata().pending_interactions.len(), 2);
    assert_eq!(
        machine
            .metadata()
            .pending_elicitation()
            .unwrap()
            .request_id
            .to_request_id(),
        agent_client_protocol::schema::v1::RequestId::Number(2)
    );
}

#[test]
fn ending_stopping_and_disconnecting_clear_both_live_requests() {
    for ending in ["end", "stop", "disconnect", "reconnect", "next_turn"] {
        let mut machine = FoldMachineImpl::new();
        prompt(&mut machine, "p");
        push(&mut machine, "to_server", permission(json!(1)));
        push(&mut machine, "to_server", question(json!(2)));
        match ending {
            "end" => {
                push(
                    &mut machine,
                    "to_server",
                    json!({"id": "p", "result": {"stopReason": "end_turn"}}),
                );
            }
            "stop" => {
                push(
                    &mut machine,
                    "to_runtime",
                    json!({"method": "session/cancel", "params": {"sessionId": "s"}}),
                );
            }
            "next_turn" => prompt(&mut machine, "next"),
            _ => {
                let event = if ending == "disconnect" {
                    "disconnected"
                } else {
                    "acp_ready"
                };
                let line =
                    json!({"direction": "to_server", "content": {"type": "event", "event": event}})
                        .to_string();
                let _ = machine.push(parse_log(&line).remove(0));
            }
        }
        assert!(
            machine.metadata().pending_interactions.is_empty(),
            "{ending}"
        );
        assert!(
            machine
                .messages()
                .iter()
                .flat_map(|message| message.parts.iter())
                .any(|part| matches!(
                    part,
                    MessagePart::Permission {
                        outcome: PermissionOutcome::Pending,
                        ..
                    }
                )),
            "history survives {ending}"
        );
    }
}
