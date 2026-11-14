//! Bounded activity derived from the generated SDK operation catalog. It is
//! advisory for people, but whole unless `activity_truncated` says otherwise:
//! a routine draft skips waiting for its session's writes on the strength of
//! it ([`ExecutionRecord::may_have_written`]). Anything that can lose a
//! request's frame must set the flag.
use super::{ExecutionActivity, ExecutionRecord, ExecutionStatus, RecordedCallStatus};
use code_execution::domain::operations;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::LazyLock;

#[cfg(test)]
mod test;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Activity {
    id: u64,
    service: String,
    operation: String,
    status: String,
}

pub(super) fn observe(
    activity: &mut Vec<ExecutionActivity>,
    truncated: &mut bool,
    value: serde_json::Value,
) {
    if value == serde_json::json!({"truncated": true}) {
        *truncated = true;
        return;
    }
    // A frame that can't be read, or names an operation the catalog doesn't
    // have, may be a request this can't label: the activity isn't whole.
    let Ok(event) = serde_json::from_value::<Activity>(value) else {
        *truncated = true;
        return;
    };
    let Some(label) = operations()
        .get(&format!("{}.{}", event.service, event.operation))
        .map(|operation| &operation.label)
    else {
        *truncated = true;
        return;
    };
    let status = match event.status.as_str() {
        "started" => RecordedCallStatus::Running,
        "completed" => RecordedCallStatus::Completed,
        "failed" => RecordedCallStatus::Failed,
        // A dry run's gate answered it; nothing was sent.
        "skipped" | "refused" => return,
        _ => {
            *truncated = true;
            return;
        }
    };
    if let Some(existing) = activity.iter_mut().find(|item| item.id == event.id) {
        if existing.label == *label && existing.status == RecordedCallStatus::Running {
            existing.status = status;
        }
    } else if status == RecordedCallStatus::Running {
        if activity.len() < 128 {
            activity.push(ExecutionActivity {
                id: event.id,
                label: label.clone(),
                status,
            });
        } else {
            *truncated = true;
        }
    }
}

/// Whether a program's frames were read to its own end. A deadline, a
/// cancel or a supervisor failure stops reading early, and a request the
/// program had sent may have lost its frame.
pub(super) fn ran_to_end(outcome: &code_execution::domain::Outcome) -> bool {
    use code_execution::domain::{FailureCode, Outcome};
    match outcome {
        Outcome::Succeeded { .. } => true,
        Outcome::Failed { error } => {
            matches!(error.code, FailureCode::Runtime | FailureCode::Compile)
        }
        Outcome::Cancelled | Outcome::TimedOut => false,
    }
}

pub(super) fn finish(activity: &mut [ExecutionActivity]) {
    for activity in activity {
        if activity.status == RecordedCallStatus::Running {
            activity.status = RecordedCallStatus::Unknown;
        }
    }
}

/// Labels only reads have: every catalog operation with the label is a read.
static READ_LABELS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    let writes: HashSet<&str> = operations()
        .values()
        .filter(|operation| operation.write)
        .map(|operation| operation.label.as_str())
        .collect();
    operations()
        .values()
        .map(|operation| operation.label.as_str())
        .filter(|label| !writes.contains(label))
        .collect()
});

impl ExecutionRecord {
    /// Whether the program may have changed anything: false only once it has
    /// finished, its activity is whole (it ran to its own end, every frame
    /// was read) and every operation it called reads.
    pub fn may_have_written(&self) -> bool {
        self.status == ExecutionStatus::Running
            || self.activity_truncated
            || !self.calls.is_empty()
            || self
                .activity
                .iter()
                .any(|activity| !READ_LABELS.contains(activity.label.as_str()))
    }
}
