//! Shared live-request lifecycle, preserving each protocol's answer shape.

use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;
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

fn tool_approval(status: &str, resolved_by: Option<&str>) -> Value {
    let mut params = json!({
        "approvalId": "a1", "serverSlug": "macro", "serverName": "Macro",
        "toolName": "ListEmails", "arguments": {"limit": 5},
        "requestedBy": "macro|julia@macro.com", "status": status,
    });
    if let Some(by) = resolved_by {
        params["resolvedBy"] = json!(by);
    }
    json!({"method": "_macro/tool_approval", "params": params})
}

fn approval_part(machine: &FoldMachineImpl) -> MessagePart {
    machine
        .messages()
        .iter()
        .flat_map(|message| message.parts.iter())
        .find(|part| matches!(part, MessagePart::ToolApproval { .. }))
        .cloned()
        .expect("the held call is in the transcript")
}

#[test]
fn a_held_tool_call_blocks_the_turn_until_it_is_resolved() {
    let mut machine = FoldMachineImpl::new();
    prompt(&mut machine, "p");
    assert!(push(
        &mut machine,
        "to_server",
        tool_approval("pending", None)
    ));
    assert_eq!(machine.metadata().turn, TurnState::Blocked);
    let [PendingInteraction::ToolApproval(pending)] =
        machine.metadata().pending_interactions.as_slice()
    else {
        panic!("one held call is pending");
    };
    assert_eq!(pending.approval_id, "a1");
    assert_eq!(pending.tool_name, "ListEmails");
    assert_eq!(
        pending.requested_by.as_deref(),
        Some("macro|julia@macro.com")
    );

    assert!(push(
        &mut machine,
        "to_server",
        tool_approval("approved", Some("macro|wolf@macro.com"))
    ));
    assert!(machine.metadata().pending_interactions.is_empty());
    assert_eq!(machine.metadata().turn, TurnState::Running);
    assert!(matches!(
        approval_part(&machine),
        MessagePart::ToolApproval { status: ToolApprovalStatus::Approved, resolved_by: Some(by), .. }
            if by == "macro|wolf@macro.com"
    ));
}

#[test]
fn a_held_tool_call_approved_for_good_says_so() {
    let mut machine = FoldMachineImpl::new();
    prompt(&mut machine, "p");
    push(&mut machine, "to_server", tool_approval("pending", None));
    assert!(matches!(
        approval_part(&machine),
        MessagePart::ToolApproval {
            remembered: false,
            ..
        }
    ));

    let mut approved = tool_approval("approved", Some("macro|wolf@macro.com"));
    approved["params"]["remembered"] = json!(true);
    assert!(push(&mut machine, "to_server", approved));
    assert!(matches!(
        approval_part(&machine),
        MessagePart::ToolApproval {
            status: ToolApprovalStatus::Approved,
            remembered: true,
            ..
        }
    ));
}

#[test]
fn a_held_tool_call_outside_a_turn_or_resolved_twice_changes_nothing() {
    let mut machine = FoldMachineImpl::new();
    assert!(!push(
        &mut machine,
        "to_server",
        tool_approval("pending", None)
    ));
    assert!(machine.messages().is_empty());

    prompt(&mut machine, "p");
    push(&mut machine, "to_server", tool_approval("pending", None));
    push(&mut machine, "to_server", tool_approval("denied", None));
    assert!(!push(
        &mut machine,
        "to_server",
        tool_approval("expired", None)
    ));
    assert!(matches!(
        approval_part(&machine),
        MessagePart::ToolApproval {
            status: ToolApprovalStatus::Denied,
            ..
        }
    ));
}

#[test]
fn stopping_the_turn_hides_a_held_tool_call() {
    let mut machine = FoldMachineImpl::new();
    prompt(&mut machine, "p");
    push(&mut machine, "to_server", tool_approval("pending", None));
    push(
        &mut machine,
        "to_runtime",
        json!({"method": "session/cancel", "params": {"sessionId": "s"}}),
    );
    assert!(machine.metadata().pending_interactions.is_empty());
}
