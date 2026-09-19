use super::*;
use crate::domain::event::Truncation;

fn tool_call(call_id: &str, status: &str) -> CursorEvent {
    CursorEvent::ToolCall(ToolCallEvent {
        call_id: call_id.to_owned(),
        name: "run_terminal_cmd".to_owned(),
        status: Some(status.to_owned()),
        args: None,
        result: None,
        truncated: Truncation::default(),
    })
}

#[test]
fn a_call_left_running_is_closed_as_failed() {
    let mut machine = TranslateMachine::new();
    machine.push(tool_call("call-1", "running"));

    let updates = machine.close_open_calls();
    assert_eq!(updates.len(), 1);
    let SessionUpdate::ToolCallUpdate(update) = &updates[0] else {
        panic!("expected a tool_call_update, got {updates:?}");
    };
    assert_eq!(&*update.tool_call_id.0, "call-1");
    assert_eq!(update.fields.status, Some(ToolCallStatus::Failed));
}

#[test]
fn a_call_already_completed_is_not_closed_again() {
    let mut machine = TranslateMachine::new();
    machine.push(tool_call("call-1", "running"));
    machine.push(tool_call("call-1", "completed"));

    assert!(machine.close_open_calls().is_empty());
}

#[test]
fn only_calls_still_open_are_closed() {
    let mut machine = TranslateMachine::new();
    machine.push(tool_call("call-1", "running"));
    machine.push(tool_call("call-2", "running"));
    machine.push(tool_call("call-1", "completed"));

    let updates = machine.close_open_calls();
    assert_eq!(updates.len(), 1);
    let SessionUpdate::ToolCallUpdate(update) = &updates[0] else {
        panic!("expected a tool_call_update, got {updates:?}");
    };
    assert_eq!(&*update.tool_call_id.0, "call-2");
}

#[test]
fn closing_drains_so_a_second_call_finds_nothing_left() {
    let mut machine = TranslateMachine::new();
    machine.push(tool_call("call-1", "running"));

    assert_eq!(machine.close_open_calls().len(), 1);
    assert!(machine.close_open_calls().is_empty());
}
