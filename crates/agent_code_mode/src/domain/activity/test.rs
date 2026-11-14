use super::super::{ExecutionId, ExecutionStatus};
use super::*;
use code_execution::domain::{ExecutionFailure, FailureCode, Outcome};
use serde_json::json;

/// A read and a write from the generated catalog, pinned by key so the
/// tests don't take their expectations from the code under test.
const READ: (&str, &str) = ("scheduled-action.checkScheduledAction", "Check routine");
const WRITE: (&str, &str) = ("storage.createDocument", "Create Document");

fn record(status: ExecutionStatus, labels: &[&str]) -> ExecutionRecord {
    ExecutionRecord {
        execution_id: ExecutionId::mint(),
        acting_as: None,
        turn_id: None,
        source: String::new(),
        status,
        result: None,
        error: None,
        calls: Vec::new(),
        activity: labels
            .iter()
            .zip(1..)
            .map(|(label, id)| ExecutionActivity {
                id,
                label: (*label).to_owned(),
                status: RecordedCallStatus::Completed,
            })
            .collect(),
        activity_truncated: false,
    }
}

fn frame(id: u64, key: &str, status: &str) -> serde_json::Value {
    let (service, operation) = key.split_once('.').unwrap_or_default();
    json!({"id": id, "service": service, "operation": operation, "status": status})
}

/// The activity and truncation a sequence of frames leaves.
fn observed(frames: impl IntoIterator<Item = serde_json::Value>) -> (Vec<ExecutionActivity>, bool) {
    let mut activity = Vec::new();
    let mut truncated = false;
    for value in frames {
        observe(&mut activity, &mut truncated, value);
    }
    (activity, truncated)
}

#[test]
fn the_pinned_catalog_entries_are_a_read_and_a_write() {
    let read = &operations()[READ.0];
    let write = &operations()[WRITE.0];
    assert_eq!((read.label.as_str(), read.write), (READ.1, false));
    assert_eq!((write.label.as_str(), write.write), (WRITE.1, true));
}

#[test]
fn a_finished_program_that_only_read_wrote_nothing() {
    assert!(!record(ExecutionStatus::Succeeded, &[READ.1]).may_have_written());
    assert!(!record(ExecutionStatus::Failed, &[]).may_have_written());
}

#[test]
fn a_write_a_running_program_or_lost_activity_may_have_written() {
    assert!(record(ExecutionStatus::Succeeded, &[READ.1, WRITE.1]).may_have_written());
    assert!(record(ExecutionStatus::Running, &[]).may_have_written());
    let mut truncated = record(ExecutionStatus::Succeeded, &[]);
    truncated.activity_truncated = true;
    assert!(truncated.may_have_written());
    assert!(record(ExecutionStatus::Succeeded, &["Not a catalog label"]).may_have_written());
}

#[test]
fn observed_frames_become_labelled_activity() {
    let (activity, truncated) = observed([
        frame(1, READ.0, "started"),
        frame(2, WRITE.0, "started"),
        frame(1, READ.0, "completed"),
        frame(2, WRITE.0, "failed"),
    ]);
    assert!(!truncated);
    let seen: Vec<_> = activity
        .iter()
        .map(|item| (item.id, item.label.as_str(), item.status))
        .collect();
    assert_eq!(
        seen,
        [
            (1, READ.1, RecordedCallStatus::Completed),
            (2, WRITE.1, RecordedCallStatus::Failed),
        ]
    );
}

#[test]
fn a_gated_operation_leaves_no_activity_and_keeps_it_whole() {
    let (activity, truncated) =
        observed([frame(1, WRITE.0, "skipped"), frame(2, WRITE.0, "refused")]);
    assert!(activity.is_empty());
    assert!(!truncated);
}

#[test]
fn a_frame_that_cant_be_labelled_marks_the_activity_incomplete() {
    for value in [
        json!({"truncated": true}),
        json!({"id": 1, "service": "storage"}),
        frame(1, "storage.notAnOperation", "started"),
        frame(1, READ.0, "paused"),
    ] {
        let (activity, truncated) = observed([value.clone()]);
        assert!(activity.is_empty(), "{value}");
        assert!(truncated, "{value}");
    }
}

#[test]
fn requests_past_the_bound_mark_the_activity_incomplete() {
    let (activity, truncated) = observed((1..=128).map(|id| frame(id, READ.0, "started")));
    assert_eq!(activity.len(), 128);
    assert!(!truncated);
    let (activity, truncated) = observed((1..=129).map(|id| frame(id, READ.0, "started")));
    assert_eq!(activity.len(), 128);
    assert!(truncated);
}

#[test]
fn only_a_program_that_reached_its_own_end_ran_to_end() {
    let failed = |code| Outcome::Failed {
        error: ExecutionFailure::new(code, ""),
    };
    assert!(ran_to_end(&Outcome::Succeeded { value: json!(null) }));
    assert!(ran_to_end(&failed(FailureCode::Runtime)));
    assert!(ran_to_end(&failed(FailureCode::Compile)));
    for outcome in [
        Outcome::Cancelled,
        Outcome::TimedOut,
        failed(FailureCode::Protocol),
        failed(FailureCode::Limit),
        failed(FailureCode::Internal),
    ] {
        assert!(!ran_to_end(&outcome), "{outcome:?}");
    }
}
