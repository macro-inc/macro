//! Bounded, advisory activity derived from the generated SDK operation catalog.
use super::{ActivityItem, ExecutionActivity, RecordedCallStatus};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::LazyLock};

static OPERATIONS: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("operations.json")).expect("generated operation catalog")
});

/// The longest item id and title a card keeps; the SDK sends titles no longer.
const MAX_ITEM_ID: usize = 128;
const MAX_ITEM_TITLE: usize = 100;
/// The most items one run keeps, as the SDK reports no more: the receipt
/// carrying them goes to the model too.
const MAX_ITEMS: usize = 32;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Activity {
    id: u64,
    service: String,
    operation: String,
    status: String,
    /// Read on its own, so an item this version cannot read still lets the
    /// operation finish.
    #[serde(default)]
    item: Option<serde_json::Value>,
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
    let Some(label) = OPERATIONS.get(&format!("{}.{}", event.service, event.operation)) else {
        return;
    };
    let status = match event.status.as_str() {
        "started" => RecordedCallStatus::Running,
        "completed" => RecordedCallStatus::Completed,
        "failed" => RecordedCallStatus::Failed,
        _ => return,
    };
    let items = activity.iter().filter(|entry| entry.item.is_some()).count();
    if let Some(existing) = activity.iter_mut().find(|item| item.id == event.id) {
        if existing.label == *label && existing.status == RecordedCallStatus::Running {
            existing.status = status;
            if status == RecordedCallStatus::Completed && items < MAX_ITEMS {
                existing.item = event.item.and_then(item);
            }
        }
    } else if status == RecordedCallStatus::Running {
        if activity.len() < 128 {
            activity.push(ExecutionActivity {
                id: event.id,
                label: label.clone(),
                status,
                item: None,
            });
        } else {
            *truncated = true;
        }
    }
}

/// An item as a card can carry it: an id of plain characters, and a title
/// trimmed to a line.
fn item(value: serde_json::Value) -> Option<ActivityItem> {
    let mut item = serde_json::from_value::<ActivityItem>(value).ok()?;
    let plain = |character: char| character.is_ascii_alphanumeric() || "-_".contains(character);
    if item.id.is_empty() || item.id.len() > MAX_ITEM_ID || !item.id.chars().all(plain) {
        return None;
    }
    item.title = item.title.and_then(|title| {
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        (!title.is_empty()).then(|| title.chars().take(MAX_ITEM_TITLE).collect())
    });
    Some(item)
}

pub(super) fn finish(activity: &mut [ExecutionActivity]) {
    for activity in activity {
        if activity.status == RecordedCallStatus::Running {
            activity.status = RecordedCallStatus::Unknown;
        }
    }
}
