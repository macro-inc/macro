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

fn result(pr_url: Option<&str>) -> CursorEvent {
    use crate::domain::event::{GitBranch, GitState};
    use crate::domain::model::{CursorRunId, RunStatus};
    CursorEvent::Result {
        run_id: CursorRunId::new("run-1".to_owned()),
        status: RunStatus::Finished,
        text: Some("done".to_owned()),
        duration_ms: Some(1),
        git: Some(GitState {
            branches: vec![GitBranch {
                repo_url: "github.com/macro-inc/macro".to_owned(),
                branch: Some("cursor/fix-1234".to_owned()),
                pr_url: pr_url.map(str::to_owned),
            }],
        }),
    }
}

#[test]
fn a_result_with_a_pull_request_announces_it_once() {
    let mut machine = TranslateMachine::new();
    let url = "https://github.com/macro-inc/macro/pull/6303";

    let updates = machine.push(result(Some(url)));
    let [SessionUpdate::SessionInfoUpdate(info)] = updates.as_slice() else {
        panic!("expected one session_info_update, got {updates:?}");
    };
    assert_eq!(
        info.meta.as_ref().and_then(|meta| meta.get("cursor")),
        Some(&serde_json::json!({ "pullRequestUrl": url }))
    );

    // The next run restates the same branches; the client heard already.
    assert!(machine.push(result(Some(url))).is_empty());
}

#[test]
fn a_result_without_a_pull_request_announces_nothing() {
    let mut machine = TranslateMachine::new();
    assert!(machine.push(result(None)).is_empty());
}
