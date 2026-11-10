//! Explicit read-only transport for one current direct-root checklist plan.
use super::{checklist_controls::collect_checklist_metadata, checklist_plan as plan};
use crate::nodes::Maybe;
use lexical_model::{EditorState, Error, NodeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[cfg(test)]
mod test;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    list_key: u32,
    tasks: BTreeMap<String, TaskInfo>,
    names: BTreeMap<String, String>,
    calendar: Calendar,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskInfo {
    status_option_id: Option<String>,
    priority_option_id: Option<String>,
    assignee_ids: Vec<String>,
    due: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Calendar {
    today: Observation,
    due_dates: BTreeMap<String, ParsedDate>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum ParsedDate {
    Invalid,
    Valid { observation: Observation },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    instant_ms: i64,
    local: LocalTime,
    start_of_day: Midnight,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Midnight {
    Invalid,
    Valid {
        #[serde(rename = "instantMs")]
        instant_ms: i64,
        local: LocalTime,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalTime {
    year: i32,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
    millisecond: u16,
}
impl LocalTime {
    fn into_plan(self) -> plan::CivilDateTime {
        plan::CivilDateTime {
            date: plan::CivilDate {
                year: self.year,
                month: self.month,
                day: self.day,
            },
            hour: self.hour,
            minute: self.minute,
            second: self.second,
            millisecond: self.millisecond,
        }
    }
}
impl Observation {
    fn into_plan(self) -> plan::DateObservation {
        plan::DateObservation {
            instant_ms: self.instant_ms,
            local: self.local.into_plan(),
            start_of_day: match self.start_of_day {
                Midnight::Invalid => plan::NormalizedMidnight::Invalid,
                Midnight::Valid { instant_ms, local } => plan::NormalizedMidnight::Valid {
                    instant_ms,
                    local: local.into_plan(),
                },
            },
        }
    }
}

fn key(key: NodeKey) -> Value {
    json!({"index":key.index(), "generation":key.generation()})
}
fn maybe(value: Maybe<String>) -> Value {
    match value {
        Maybe::Missing => json!({"kind":"missing"}),
        Maybe::Null => json!({"kind":"null"}),
        Maybe::Value(value) => json!({"kind":"value","value":value}),
    }
}

/// Unknown names remain available to other application query children.
/// The enclosing adapter must also reject stale generations before JSON decoding.
pub(super) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name != "group-b.checklist-plan" {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("checklist query generation"));
    }
    let request: Request = serde_json::from_value(data.clone())?;
    let metadata = collect_checklist_metadata(state)?;
    let meta = metadata
        .iter()
        .find(|meta| meta.list_key.index() == request.list_key)
        .ok_or(Error::Invariant("checklist query target"))?;
    let tasks = request
        .tasks
        .into_iter()
        .map(|(id, task)| {
            (
                id,
                plan::TaskInfo {
                    status_option_id: task.status_option_id,
                    priority_option_id: task.priority_option_id,
                    assignee_ids: task.assignee_ids,
                    due: task.due,
                },
            )
        })
        .collect();
    let calendar = plan::ChecklistCalendar {
        today: request.calendar.today.into_plan(),
        due_dates: request
            .calendar
            .due_dates
            .into_iter()
            .map(|(due, value)| {
                (
                    due,
                    match value {
                        ParsedDate::Invalid => plan::ParsedDueDate::Invalid,
                        ParsedDate::Valid { observation } => {
                            plan::ParsedDueDate::Valid(observation.into_plan())
                        }
                    },
                )
            })
            .collect(),
    };
    let result = plan::plan_checklist(Some(meta), &tasks, &request.names, &calendar);
    Ok(Some(encode(meta, result)))
}

fn encode(
    meta: &super::checklist_controls::ChecklistMeta,
    result: plan::ChecklistPlanResult,
) -> Value {
    let list_key = key(meta.list_key);
    match result {
        plan::ChecklistPlanResult::Planned(plan) => {
            let ratio = plan.progress.completion_ratio();
            let percentage = plan.progress.percentage();
            let items: Vec<_> = plan.items.into_iter().zip(&meta.items).map(|(item, original)| json!({
                "key":key(item.key), "checked":item.checked, "text":item.text,
                "taskId":maybe(original.task_id.clone()), "leadingKeys":item.leading_keys.into_iter().map(key).collect::<Vec<_>>(), "attachedKeys":item.attached_keys.into_iter().map(key).collect::<Vec<_>>(), "status":item.status.as_str(),
                "priority":item.priority.map(|priority| priority.as_ref().to_owned()),
                "assignees":item.assignees.into_iter().map(|assignee| json!({"id":maybe(assignee.id),"name":assignee.name})).collect::<Vec<_>>(),
                "due":maybe(item.due),
            })).collect();
            json!({
                "kind":"planned", "listKey":list_key, "items":items,
                "settings":{"filters":{"status":plan.settings.filters.status,"priority":plan.settings.filters.priority,"assignees":plan.settings.filters.assignees,"due":plan.settings.filters.due}},
                "rows":plan.rows.into_iter().map(|row| json!({"key":key(row.key),"dimmed":row.dimmed})).collect::<Vec<_>>(),
                "active":plan.active,"filterCount":plan.filter_count,"hasTasks":plan.has_tasks,
                "progress":{"done":plan.progress.done,"total":plan.progress.total,"ratio":ratio,"percentage":percentage},
            })
        }
        plan::ChecklistPlanResult::UnsupportedInput { field, raw } => {
            json!({"kind":"unsupportedInput","listKey":list_key,"field":field,"settingsContext":raw})
        }
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
            json!({"kind":"invalidCalendarFacts","listKey":list_key,"problem":problem})
        }
    }
}
