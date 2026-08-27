use super::*;
use crate::domain::event::{InteractionUpdate, Truncation};

fn tool_call(call_id: &str, status: &str) -> CursorEvent {
    named_tool_call(call_id, "run_terminal_cmd", status)
}

fn named_tool_call(call_id: &str, name: &str, status: &str) -> CursorEvent {
    CursorEvent::ToolCall(ToolCallEvent {
        call_id: call_id.to_owned(),
        name: name.to_owned(),
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

/// A finished call's learned kind must not leak onto a later call that
/// reuses its id — the fresh call gets classified from its own name, not the
/// old call's typed descriptor.
#[test]
fn a_reused_call_id_does_not_inherit_a_finished_calls_kind() {
    let mut machine = TranslateMachine::new();
    machine.push(named_tool_call("call-1", "run_terminal_cmd", "running"));
    machine.push(CursorEvent::Interaction(
        InteractionUpdate::ToolCallStarted {
            call_id: "call-1".to_owned(),
            tool_type: Some("shell".to_owned()),
        },
    ));
    machine.push(named_tool_call("call-1", "run_terminal_cmd", "completed"));
    // Cursor's recorded ordering puts this descriptor after the terminal
    // tool-call frame. It must not recreate metadata for the finished call.
    machine.push(CursorEvent::Interaction(
        InteractionUpdate::ToolCallCompleted {
            call_id: "call-1".to_owned(),
            tool_type: Some("shell".to_owned()),
        },
    ));

    let update = machine.push(named_tool_call("call-1", "read_file", "running"));
    let SessionUpdate::ToolCall(announcement) = &update[0] else {
        panic!("a reused id is a fresh announcement, got {update:?}");
    };
    assert_eq!(
        announcement.kind,
        ToolKind::Read,
        "must classify from read_file's own name, not shell's stale learned kind"
    );
}

#[test]
fn closing_drains_so_a_second_call_finds_nothing_left() {
    let mut machine = TranslateMachine::new();
    machine.push(tool_call("call-1", "running"));

    assert_eq!(machine.close_open_calls().len(), 1);
    assert!(machine.close_open_calls().is_empty());
}
