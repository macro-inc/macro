use super::*;
use crate::domain::journal::NativeRecord;

fn journaled(input: &JournalInput) -> serde_json::Value {
    serde_json::to_value(input).expect("journal inputs serialize")
}

#[test]
fn a_result_record_with_a_branch_is_read() {
    let record = JournalInput::Sse(NativeRecord {
        event: "result".to_owned(),
        data: serde_json::json!({
            "runId": "run_1",
            "status": "FINISHED",
            "git": { "branches": [
                { "repoUrl": "github.com/macro-inc/macro", "branch": "cursor/fix-dots", "prUrl": null }
            ] }
        })
        .to_string(),
        id: None,
    });
    let branch = pushed_branch(&journaled(&record)).expect("a branch");
    assert_eq!(branch.repo_url, "github.com/macro-inc/macro");
    assert_eq!(branch.branch.as_deref(), Some("cursor/fix-dots"));
}

#[test]
fn a_polling_body_with_a_branch_is_read() {
    let poll = JournalInput::Poll(
        serde_json::json!({
            "status": "FINISHED",
            "result": "done",
            "git": { "branches": [ { "repoUrl": "github.com/o/r", "branch": "b" } ] }
        })
        .to_string(),
    );
    assert_eq!(
        pushed_branch(&journaled(&poll)).and_then(|b| b.branch),
        Some("b".to_owned())
    );
}

#[test]
fn records_without_a_pushed_branch_are_skipped() {
    let no_git = JournalInput::Sse(NativeRecord {
        event: "result".to_owned(),
        data: serde_json::json!({ "status": "FINISHED" }).to_string(),
        id: None,
    });
    assert!(pushed_branch(&journaled(&no_git)).is_none());

    let no_branch = JournalInput::Sse(NativeRecord {
        event: "result".to_owned(),
        data: serde_json::json!({ "git": { "branches": [ { "repoUrl": "github.com/o/r" } ] } })
            .to_string(),
        id: None,
    });
    assert!(pushed_branch(&journaled(&no_branch)).is_none());

    let other_event = JournalInput::Sse(NativeRecord {
        event: "assistant".to_owned(),
        data: serde_json::json!({ "git": { "branches": [ { "repoUrl": "x", "branch": "y" } ] } })
            .to_string(),
        id: None,
    });
    assert!(pushed_branch(&journaled(&other_event)).is_none());
    assert!(pushed_branch(&journaled(&JournalInput::HistoryComplete)).is_none());
}
