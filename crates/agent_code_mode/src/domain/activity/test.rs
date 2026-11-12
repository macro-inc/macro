use super::super::{ExecutionId, ExecutionStatus};
use super::*;

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

/// The label of one of the catalog's writes, or of one of its reads.
fn label(write: bool) -> &'static str {
    operations()
        .values()
        .map(|operation| operation.label.as_str())
        .find(|label| READ_LABELS.contains(label) != write)
        .unwrap_or_default()
}

#[test]
fn a_finished_program_that_only_read_wrote_nothing() {
    let read = label(false);
    assert!(!read.is_empty());
    assert!(!record(ExecutionStatus::Succeeded, &[read, "Check routine"]).may_have_written());
    assert!(!record(ExecutionStatus::Failed, &[]).may_have_written());
}

#[test]
fn a_write_a_running_program_or_lost_activity_may_have_written() {
    let write = label(true);
    assert!(!write.is_empty());
    assert!(record(ExecutionStatus::Succeeded, &[label(false), write]).may_have_written());
    assert!(record(ExecutionStatus::Running, &[]).may_have_written());
    let mut truncated = record(ExecutionStatus::Succeeded, &[]);
    truncated.activity_truncated = true;
    assert!(truncated.may_have_written());
    assert!(record(ExecutionStatus::Succeeded, &["Not a catalog label"]).may_have_written());
}
