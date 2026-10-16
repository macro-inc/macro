//! Bounded, advisory activity derived from the generated SDK operation catalog.
use super::{ExecutionActivity, ExecutionRecord, RecordedCallStatus};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::LazyLock};

static OPERATIONS: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("operations.json")).expect("generated operation catalog")
});

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Activity {
    id: u64,
    service: String,
    operation: String,
    status: String,
}

pub(super) fn observe(record: &mut ExecutionRecord, value: serde_json::Value) {
    if value == serde_json::json!({"truncated": true}) {
        record.activity_truncated = true;
        return;
    }
    let Ok(event) = serde_json::from_value::<Activity>(value) else {
        return;
    };
    let Some(label) = OPERATIONS.get(&format!("{}.{}", event.service, event.operation)) else {
        return;
    };
    let status = match event.status.as_str() {
        "started" => RecordedCallStatus::Running,
        "completed" => RecordedCallStatus::Completed,
        "failed" => RecordedCallStatus::Failed,
        _ => return,
    };
    if let Some(existing) = record.activity.iter_mut().find(|item| item.id == event.id) {
        if existing.label == *label && existing.status == RecordedCallStatus::Running {
            existing.status = status;
        }
    } else if status == RecordedCallStatus::Running {
        if record.activity.len() < 128 {
            record.activity.push(ExecutionActivity {
                id: event.id,
                label: label.clone(),
                status,
            });
        } else {
            record.activity_truncated = true;
        }
    }
}

pub(super) fn finish(record: &mut ExecutionRecord) {
    for activity in &mut record.activity {
        if activity.status == RecordedCallStatus::Running {
            activity.status = RecordedCallStatus::Unknown;
        }
    }
}
