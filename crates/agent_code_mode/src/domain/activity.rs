//! Bounded, advisory activity derived from the generated SDK operation catalog.
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
    let Ok(event) = serde_json::from_value::<Activity>(value) else {
        return;
    };
    let Some(label) = operations()
        .get(&format!("{}.{}", event.service, event.operation))
        .map(|operation| &operation.label)
    else {
        return;
    };
    let status = match event.status.as_str() {
        "started" => RecordedCallStatus::Running,
        "completed" => RecordedCallStatus::Completed,
        "failed" => RecordedCallStatus::Failed,
        _ => return,
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
    /// finished, its activity is whole and every operation it called reads.
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
