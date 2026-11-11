//! Presentation projection and key-addressed transport; no text or graphs retained.
use super::super::{checklist_controls::ChecklistMeta, checklist_plan as plan};
use crate::nodes::Maybe;
use lexical_model::NodeKey;
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub(super) struct Key {
    index: u32,
    generation: u32,
}
impl From<NodeKey> for Key {
    fn from(key: NodeKey) -> Self {
        Self {
            index: key.index(),
            generation: key.generation(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum MaybeString {
    Missing,
    Null,
    Value { value: String },
}
impl From<Maybe<String>> for MaybeString {
    fn from(value: Maybe<String>) -> Self {
        match value {
            Maybe::Missing => Self::Missing,
            Maybe::Null => Self::Null,
            Maybe::Value(value) => Self::Value { value },
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
struct Assignee {
    id: MaybeString,
    name: String,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Item {
    key: Key,
    task_id: MaybeString,
    assignees: Vec<Assignee>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub(super) struct Row {
    key: Key,
    dimmed: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
struct Filters {
    status: Vec<String>,
    priority: Vec<String>,
    assignees: Vec<String>,
    due: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
struct Settings {
    filters: Filters,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
struct Progress {
    done: usize,
    total: usize,
    ratio: f64,
    percentage: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Bar {
    settings: Settings,
    active: bool,
    filter_count: usize,
    has_tasks: bool,
    progress: Progress,
    items: Vec<Item>,
    rows: Vec<Row>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum Presentation {
    Planned(Bar),
    UnsupportedInput {
        field: &'static str,
        #[serde(rename = "settingsContext")]
        settings_context: Arc<Value>,
    },
    InvalidCalendarFacts {
        problem: Value,
    },
}
impl Presentation {
    pub(super) fn new(meta: &ChecklistMeta, result: plan::ChecklistPlanResult) -> Self {
        match result {
            plan::ChecklistPlanResult::Planned(plan) => {
                let progress = Progress {
                    done: plan.progress.done,
                    total: plan.progress.total,
                    ratio: plan.progress.completion_ratio(),
                    percentage: plan.progress.percentage(),
                };
                let filters = plan.settings.filters;
                let items = plan
                    .items
                    .into_iter()
                    .zip(&meta.items)
                    .map(|(item, original)| Item {
                        key: item.key.into(),
                        task_id: original.task_id.clone().into(),
                        assignees: item
                            .assignees
                            .into_iter()
                            .map(|assignee| Assignee {
                                id: assignee.id.into(),
                                name: assignee.name,
                            })
                            .collect(),
                    })
                    .collect();
                Self::Planned(Bar {
                    settings: Settings {
                        filters: Filters {
                            status: filters.status,
                            priority: filters.priority,
                            assignees: filters.assignees,
                            due: filters.due,
                        },
                    },
                    active: plan.active,
                    filter_count: plan.filter_count,
                    has_tasks: plan.has_tasks,
                    progress,
                    items,
                    rows: plan
                        .rows
                        .into_iter()
                        .map(|row| Row {
                            key: row.key.into(),
                            dimmed: row.dimmed,
                        })
                        .collect(),
                })
            }
            plan::ChecklistPlanResult::UnsupportedInput { field, raw } => Self::UnsupportedInput {
                field,
                settings_context: raw,
            },
            plan::ChecklistPlanResult::InvalidCalendarFacts(problem) => {
                let problem = match problem {
                    plan::CalendarProblem::InvalidCivilDate(date) => {
                        json!({"kind":"invalidCivilDate","year":date.year,"month":date.month,"day":date.day})
                    }
                    plan::CalendarProblem::InvalidInstant(instant) => {
                        json!({"kind":"invalidInstant","instantMs":instant})
                    }
                    plan::CalendarProblem::InvalidLocalTime(local) => {
                        json!({"kind":"invalidLocalTime","year":local.date.year,"month":local.date.month,"day":local.date.day,"hour":local.hour,"minute":local.minute,"second":local.second,"millisecond":local.millisecond})
                    }
                    plan::CalendarProblem::MissingDueObservation(due) => {
                        json!({"kind":"missingDueObservation","due":due})
                    }
                };
                Self::InvalidCalendarFacts { problem }
            }
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum RowChange {
    Remove {
        key: Key,
    },
    Place {
        key: Key,
        after: Option<Key>,
        dimmed: bool,
    },
    Dim {
        key: Key,
        dimmed: bool,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ItemChange {
    Remove { key: Key },
    Place { after: Option<Key>, item: Item },
    Update { item: Item },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Patch {
    #[serde(skip_serializing_if = "Option::is_none")]
    settings: Option<Settings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filter_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_tasks: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<Progress>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    rows: Vec<RowChange>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    items: Vec<ItemChange>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum ListUpdate {
    Remove {
        #[serde(rename = "listKey")]
        list_key: Key,
    },
    Replace {
        #[serde(rename = "listKey")]
        list_key: Key,
        result: Presentation,
    },
    Patch {
        #[serde(rename = "listKey")]
        list_key: Key,
        changes: Patch,
    },
}
pub(super) fn difference(
    key: NodeKey,
    previous: Option<&Presentation>,
    next: &Presentation,
) -> Option<ListUpdate> {
    if previous == Some(next) {
        return None;
    }
    if let (Some(Presentation::Planned(before)), Presentation::Planned(after)) = (previous, next) {
        let rows_before: BTreeMap<_, _> = before
            .rows
            .iter()
            .map(|row| (row.key, row.dimmed))
            .collect();
        let rows_after: BTreeMap<_, _> = after.rows.iter().map(|row| (row.key, ())).collect();
        let mut row_order: Vec<_> = before
            .rows
            .iter()
            .filter(|row| rows_after.contains_key(&row.key))
            .map(|row| row.key)
            .collect();
        let mut rows = Vec::new();
        for row in &before.rows {
            if !rows_after.contains_key(&row.key) {
                rows.push(RowChange::Remove { key: row.key });
            }
        }
        for (i, row) in after.rows.iter().enumerate() {
            if row_order.get(i) != Some(&row.key) {
                if let Some(old) = row_order.iter().position(|key| *key == row.key) {
                    row_order.remove(old);
                }
                row_order.insert(i, row.key);
                rows.push(RowChange::Place {
                    key: row.key,
                    after: i.checked_sub(1).map(|i| after.rows[i].key),
                    dimmed: row.dimmed,
                });
            } else if rows_before.get(&row.key) != Some(&row.dimmed) {
                rows.push(RowChange::Dim {
                    key: row.key,
                    dimmed: row.dimmed,
                });
            }
        }
        let items_before: BTreeMap<_, _> =
            before.items.iter().map(|item| (item.key, item)).collect();
        let items_after: BTreeMap<_, _> = after.items.iter().map(|item| (item.key, ())).collect();
        let mut item_order: Vec<_> = before
            .items
            .iter()
            .filter(|item| items_after.contains_key(&item.key))
            .map(|item| item.key)
            .collect();
        let mut items = Vec::new();
        for item in &before.items {
            if !items_after.contains_key(&item.key) {
                items.push(ItemChange::Remove { key: item.key });
            }
        }
        for (i, item) in after.items.iter().enumerate() {
            if item_order.get(i) != Some(&item.key) {
                if let Some(old) = item_order.iter().position(|key| *key == item.key) {
                    item_order.remove(old);
                }
                item_order.insert(i, item.key);
                items.push(ItemChange::Place {
                    after: i.checked_sub(1).map(|i| after.items[i].key),
                    item: item.clone(),
                });
            } else if items_before.get(&item.key) != Some(&item) {
                items.push(ItemChange::Update { item: item.clone() });
            }
        }
        Some(ListUpdate::Patch {
            list_key: key.into(),
            changes: Patch {
                settings: (before.settings != after.settings).then(|| after.settings.clone()),
                active: (before.active != after.active).then_some(after.active),
                filter_count: (before.filter_count != after.filter_count)
                    .then_some(after.filter_count),
                has_tasks: (before.has_tasks != after.has_tasks).then_some(after.has_tasks),
                progress: (before.progress != after.progress).then_some(after.progress),
                rows,
                items,
            },
        })
    } else {
        Some(ListUpdate::Replace {
            list_key: key.into(),
            result: next.clone(),
        })
    }
}
