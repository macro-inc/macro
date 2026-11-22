//! Strict raw calendar/task observations shared by query and explicit facts input.
use super::ChecklistFacts;
use crate::plugins_group_b::checklist_plan as plan;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RawTaskInfo {
    status_option_id: Option<String>,
    priority_option_id: Option<String>,
    assignee_ids: Vec<String>,
    due: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RawCalendar {
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

pub(crate) fn into_facts(
    tasks: BTreeMap<String, RawTaskInfo>,
    names: BTreeMap<String, String>,
    calendar: RawCalendar,
) -> ChecklistFacts {
    ChecklistFacts {
        tasks: tasks
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
            .collect(),
        names,
        calendar: plan::ChecklistCalendar {
            today: calendar.today.into_plan(),
            due_dates: calendar
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
        },
    }
}
