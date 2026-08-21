use super::*;
use crate::domain::event::{CursorEvent, InteractionUpdate, ToolCallEvent, Truncation};
use crate::testing::fixture_events;
use agent_client_protocol::schema::v1::ToolCallStatus;
use serde_json::json;

fn machine() -> TranslateMachine {
    TranslateMachine::new()
}

fn shell_call(call_id: &str, status: &str) -> CursorEvent {
    CursorEvent::ToolCall(ToolCallEvent {
        call_id: call_id.to_owned(),
        name: "run_terminal_cmd".to_owned(),
        status: Some(status.to_owned()),
        args: Some(json!({"command": "echo hi"})),
        result: None,
        truncated: Truncation::default(),
    })
}

/// The bug that shipped in the TypeScript prototype: `rm` matched inside
/// "te*rm*inal" and classified the shell tool as a delete.
#[test]
fn run_terminal_cmd_is_execute_not_delete() {
    assert_eq!(kind_from_tool_name("run_terminal_cmd"), ToolKind::Execute);
}

/// Every tool name observed on a real Cursor stream, and the kind it maps to.
///
/// The list is exhaustive as of the recordings in `fixtures/real/`: these
/// twelve are what twelve live sessions produced across shell, file, search,
/// web, todo, subagent and MCP work. Nothing here is inferred from the shape
/// of the name — see [`kind_from_tool_name`]'s docs.
#[test]
fn every_observed_tool_name_maps() {
    for (name, expected) in [
        ("run_terminal_cmd", ToolKind::Execute),
        ("read_file", ToolKind::Read),
        ("edit_file", ToolKind::Edit),
        ("delete_file", ToolKind::Delete),
        ("file_search", ToolKind::Search),
        ("grep_search", ToolKind::Search),
        ("web_fetch", ToolKind::Fetch),
        ("web_search", ToolKind::Fetch),
        ("todo_write", ToolKind::Think),
        ("task", ToolKind::Other),
        ("mcp", ToolKind::Other),
        ("get_mcp_tools", ToolKind::Other),
    ] {
        assert_eq!(kind_from_tool_name(name), expected, "{name}");
    }
}

/// A name nobody has recorded is [`ToolKind::Other`], not a guess.
///
/// The previous implementation split names into tokens and matched them
/// against a hand-written vocabulary, which meant it answered confidently for
/// tools that have never existed — and got some of them wrong. `Other` is what
/// ACP has for "kind unknown", and Cursor's typed descriptor refines it a
/// moment later anyway for every tool that carries one.
#[test]
fn an_unrecorded_tool_name_is_other_rather_than_a_guess() {
    for name in [
        "mystery_gadget",
        // Plausible-looking names that the token matcher would have answered
        // for, and which Cursor has never sent.
        "apply_patch",
        "codebase_search",
        "readFile",
        "rm_file",
        "update_todos",
    ] {
        assert_eq!(kind_from_tool_name(name), ToolKind::Other, "{name}");
    }
}

/// Every typed descriptor observed on a real stream, and its kind.
#[test]
fn every_observed_cursor_tool_type_maps() {
    for (tool_type, expected) in [
        ("shell", ToolKind::Execute),
        ("read", ToolKind::Read),
        ("edit", ToolKind::Edit),
        ("delete", ToolKind::Delete),
        ("glob", ToolKind::Search),
        ("grep", ToolKind::Search),
        ("updateTodos", ToolKind::Think),
        ("task", ToolKind::Other),
        ("mcp", ToolKind::Other),
    ] {
        assert_eq!(
            kind_from_cursor_type(tool_type),
            Some(expected),
            "{tool_type}"
        );
    }
}

/// A descriptor nobody has recorded defers to the name instead of guessing.
#[test]
fn an_unrecorded_cursor_tool_type_defers_to_the_name() {
    // All four were mapped by the previous implementation on no evidence at
    // all; none has ever appeared on a stream.
    for tool_type in ["write", "search", "fetch", "web", "move", "rename"] {
        assert_eq!(kind_from_cursor_type(tool_type), None, "{tool_type}");
    }
}

/// The two signals must not contradict each other.
///
/// For the nine tools that carry a typed descriptor, the name-derived kind is
/// what a client renders on the opening announcement and the type-derived kind
/// is what refines it a moment later. If they disagreed, every tool call would
/// visibly change category mid-flight. Pairings are read off real streams.
#[test]
fn name_and_type_agree_for_every_paired_tool() {
    for (name, tool_type) in [
        ("run_terminal_cmd", "shell"),
        ("read_file", "read"),
        ("edit_file", "edit"),
        ("delete_file", "delete"),
        ("file_search", "glob"),
        ("grep_search", "grep"),
        ("todo_write", "updateTodos"),
        ("task", "task"),
        ("mcp", "mcp"),
    ] {
        assert_eq!(
            Some(kind_from_tool_name(name)),
            kind_from_cursor_type(tool_type),
            "{name} and its {tool_type} descriptor disagree"
        );
    }
}

#[test]
fn first_tool_call_announces_then_updates() {
    let mut machine = machine();
    let first = machine.push(shell_call("call-1", "running"));
    let [SessionUpdate::ToolCall(call)] = first.as_slice() else {
        panic!("expected a tool_call announcement, got {first:?}");
    };
    assert_eq!(call.kind, ToolKind::Execute);
    assert_eq!(call.status, ToolCallStatus::InProgress);

    let second = machine.push(shell_call("call-1", "completed"));
    let [SessionUpdate::ToolCallUpdate(update)] = second.as_slice() else {
        panic!("expected a tool_call_update, got {second:?}");
    };
    assert_eq!(update.fields.status, Some(ToolCallStatus::Completed));
}

/// Cursor call ids embed a literal newline; ACP ids must be one line.
#[test]
fn call_ids_lose_embedded_newlines() {
    let mut machine = machine();
    let updates = machine.push(shell_call("call-1\nfc_2", "running"));
    let [SessionUpdate::ToolCall(call)] = updates.as_slice() else {
        panic!("expected a tool_call announcement");
    };
    assert_eq!(call.tool_call_id.0.as_ref(), "call-1 fc_2");

    // The newline'd and collapsed forms are the same call.
    let updates = machine.push(shell_call("call-1 fc_2", "completed"));
    assert!(matches!(
        updates.as_slice(),
        [SessionUpdate::ToolCallUpdate(_)]
    ));
}

/// The typed descriptor arrives after the announcement, so it can only
/// refine later updates — and it outranks name inference when it does.
#[test]
fn learned_kind_refines_later_updates() {
    let mut machine = machine();
    let opened = machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "mystery_gadget".to_owned(),
        status: Some("running".to_owned()),
        args: None,
        result: None,
        truncated: Truncation::default(),
    }));
    let [SessionUpdate::ToolCall(call)] = opened.as_slice() else {
        panic!("expected announcement");
    };
    assert_eq!(call.kind, ToolKind::Other);

    assert!(
        machine
            .push(CursorEvent::Interaction(
                InteractionUpdate::ToolCallStarted {
                    call_id: "call-1".to_owned(),
                    tool_type: Some("shell".to_owned()),
                }
            ))
            .is_empty()
    );

    let updated = machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "mystery_gadget".to_owned(),
        status: Some("completed".to_owned()),
        args: None,
        result: Some(json!("10")),
        truncated: Truncation::default(),
    }));
    let [SessionUpdate::ToolCallUpdate(update)] = updated.as_slice() else {
        panic!("expected update");
    };
    assert_eq!(update.fields.kind, Some(ToolKind::Execute));
    assert_eq!(update.fields.raw_output, Some(json!({"result": "10"})));
}

#[test]
fn text_deltas_become_chunks_and_empty_ones_vanish() {
    let mut machine = machine();
    assert!(matches!(
        machine
            .push(CursorEvent::Assistant {
                text: "hi".to_owned()
            })
            .as_slice(),
        [SessionUpdate::AgentMessageChunk(_)]
    ));
    assert!(matches!(
        machine
            .push(CursorEvent::Thinking {
                text: "hm".to_owned()
            })
            .as_slice(),
        [SessionUpdate::AgentThoughtChunk(_)]
    ));
    assert!(
        machine
            .push(CursorEvent::Assistant {
                text: String::new()
            })
            .is_empty()
    );
}

/// The envelope's text subtypes duplicate the documented events one-for-one
/// on real streams; translating both would double every chunk.
#[test]
fn interaction_envelope_emits_nothing() {
    let mut machine = machine();
    for update in [
        InteractionUpdate::TokenDelta { tokens: 5 },
        InteractionUpdate::UserMessage {
            text: "hi".to_owned(),
        },
        InteractionUpdate::Other {
            kind: "text-delta".to_owned(),
        },
    ] {
        assert!(machine.push(CursorEvent::Interaction(update)).is_empty());
    }
}

/// A recording with no tool calls translates to chunks and nothing else.
///
/// The recorded corpus is swept whole — decoded, translated, and snapshotted
/// — in [`crate::replay`]'s tests; this is the one property worth asserting
/// here, next to the machine it constrains.
#[test]
fn a_toolless_recording_translates_to_chunks_only() {
    let mut machine = machine();
    let updates: Vec<SessionUpdate> = fixture_events("no_tools.sse")
        .into_iter()
        .flat_map(|event| machine.push(event))
        .collect();
    assert!(!updates.is_empty());
    assert!(updates.iter().all(|update| matches!(
        update,
        SessionUpdate::AgentMessageChunk(_) | SessionUpdate::AgentThoughtChunk(_)
    )));
}

/// Cursor reports tool failure in the result envelope, not the status word.
///
/// Recorded proof: `read_and_search`'s `get_mcp_tools` call arrives as
/// `status: "completed"` carrying `result: {"error": …}`. No fixture in the
/// corpus ever carries `status: "failed"`, so the envelope is the only
/// failure signal Cursor sends and the word cannot be trusted alone.
#[test]
fn an_error_result_envelope_marks_the_call_failed() {
    let mut machine = machine();
    let updates = machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "get_mcp_tools".to_owned(),
        status: Some("completed".to_owned()),
        args: None,
        result: Some(json!({"error": {"error": "MCP tool not found"}})),
        truncated: Truncation::default(),
    }));
    let [SessionUpdate::ToolCall(call)] = updates.as_slice() else {
        panic!("expected an announcement, got {updates:?}");
    };
    assert_eq!(
        call.status,
        ToolCallStatus::Failed,
        "an error envelope outranks the status word"
    );
}

/// A success envelope leaves the status word in charge.
#[test]
fn a_success_result_envelope_stays_completed() {
    let mut machine = machine();
    let updates = machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "run_terminal_cmd".to_owned(),
        status: Some("completed".to_owned()),
        args: None,
        result: Some(json!({"success": {"stdout": "10\n"}})),
        truncated: Truncation::default(),
    }));
    let [SessionUpdate::ToolCall(call)] = updates.as_slice() else {
        panic!("expected an announcement");
    };
    assert_eq!(call.status, ToolCallStatus::Completed);
}

/// The envelope also wins on an update, not just an announcement.
#[test]
fn an_error_envelope_fails_a_later_update_too() {
    let mut machine = machine();
    machine.push(shell_call("call-1", "running"));
    let updates = machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "run_terminal_cmd".to_owned(),
        status: Some("completed".to_owned()),
        args: None,
        result: Some(json!({"error": {"error": "command not found"}})),
        truncated: Truncation::default(),
    }));
    let [SessionUpdate::ToolCallUpdate(update)] = updates.as_slice() else {
        panic!("expected an update");
    };
    assert_eq!(update.fields.status, Some(ToolCallStatus::Failed));
}

/// An error envelope on a *running* frame is transient, not an outcome.
///
/// Recorded proof: `mcp_servers.sse` carries one `get_mcp_tools` call whose
/// first frame is `status: "running"` with `result: {"error": "Invalid
/// arguments"}`, and which then completes successfully. Reading the envelope
/// as failure there flickers the call to Failed and back, so the envelope
/// only decides the outcome once the status word says the call is done.
#[test]
fn an_error_envelope_while_running_is_not_a_failure() {
    let mut machine = machine();
    let updates = machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "get_mcp_tools".to_owned(),
        status: Some("running".to_owned()),
        args: None,
        result: Some(json!({"error": {"error": "Invalid arguments"}})),
        truncated: Truncation::default(),
    }));
    let [SessionUpdate::ToolCall(call)] = updates.as_slice() else {
        panic!("expected an announcement");
    };
    assert_eq!(
        call.status,
        ToolCallStatus::InProgress,
        "a call still running has not failed, whatever its interim result says"
    );
}

/// The same call reaching `completed` with a success envelope is completed —
/// the transient error must not linger.
#[test]
fn a_call_recovering_from_a_transient_error_completes() {
    let mut machine = machine();
    machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "get_mcp_tools".to_owned(),
        status: Some("running".to_owned()),
        args: None,
        result: Some(json!({"error": {"error": "Invalid arguments"}})),
        truncated: Truncation::default(),
    }));
    let updates = machine.push(CursorEvent::ToolCall(ToolCallEvent {
        call_id: "call-1".to_owned(),
        name: "get_mcp_tools".to_owned(),
        status: Some("completed".to_owned()),
        args: None,
        result: Some(json!({"success": {"content": "…"}})),
        truncated: Truncation::default(),
    }));
    let [SessionUpdate::ToolCallUpdate(update)] = updates.as_slice() else {
        panic!("expected an update");
    };
    assert_eq!(update.fields.status, Some(ToolCallStatus::Completed));
}
