//! Explicit read-only transport for one current direct-root checklist plan.
use super::{checklist_controls::collect_checklist_metadata_for_list, checklist_plan as plan};
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
    tasks: BTreeMap<String, super::checklist_facts::transport::RawTaskInfo>,
    names: BTreeMap<String, String>,
    calendar: super::checklist_facts::transport::RawCalendar,
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
    let actual_key = state
        .view()
        .children(NodeKey::ROOT)
        .find(|key| key.index() == request.list_key)
        .ok_or(Error::Invariant("checklist query target"))?;
    let meta = collect_checklist_metadata_for_list(state, actual_key)?
        .ok_or(Error::Invariant("checklist query target"))?;
    let facts = super::checklist_facts::transport::into_facts(
        request.tasks,
        request.names,
        request.calendar,
    );
    let result = plan::plan_checklist(Some(&meta), &facts.tasks, &facts.names, &facts.calendar);
    Ok(Some(encode(&meta, result)))
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
