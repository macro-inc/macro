//! Pure checklist presentation planning from collected metadata and host facts.
use super::checklist_controls::{ChecklistAssignee, ChecklistMeta, TaskPriority};
use crate::nodes::Maybe;
use lexical_model::NodeKey;
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};

#[cfg(test)]
mod test;

/// Properties obtained from an actual external task query, not inferred from text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaskInfo {
    /// Unknown option identifiers retain the checkbox fallback.
    pub status_option_id: Option<String>,
    /// Unknown option identifiers retain the inline marker fallback.
    pub priority_option_id: Option<String>,
    /// Nonempty assignments replace inline assignees, preserving order and repeats.
    pub assignee_ids: Vec<String>,
    /// Null falls back to the inline date; an empty string remains a real override.
    pub due: Option<String>,
}

/// Status buckets used by the source checklist controls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    /// An unchecked item without a resolved status.
    NotStarted,
    /// The actual task is in progress.
    InProgress,
    /// The actual task is in review.
    InReview,
    /// A completed task, or the checked fallback.
    Done,
    /// A canceled task also contributes to completed progress.
    Canceled,
}
impl TaskStatus {
    /// Stable source filter value, independent of display labels.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotStarted => "not-started",
            Self::InProgress => "in-progress",
            Self::InReview => "in-review",
            Self::Done => "done",
            Self::Canceled => "canceled",
        }
    }
}

/// A local Gregorian calendar observation from an actual host Date.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CivilDate {
    /// Astronomical year, including zero and the full JavaScript Date year range.
    pub year: i32,
    /// One-based month.
    pub month: u8,
    /// One-based day.
    pub day: u8,
}
impl CivilDate {
    fn ordinal(self) -> Option<i64> {
        if !(-271821..=275760).contains(&self.year) || !(1..=12).contains(&self.month) {
            return None;
        }
        let leap = self.year.rem_euclid(4) == 0
            && (self.year.rem_euclid(100) != 0 || self.year.rem_euclid(400) == 0);
        let days = match self.month {
            2 if leap => 29,
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        };
        if self.day == 0 || self.day > days {
            return None;
        }
        // Gregorian eras avoid timezone/UTC subtraction and narrower date libraries.
        let year = i64::from(self.year) - i64::from(self.month <= 2);
        let era = year.div_euclid(400);
        let year_of_era = year - era * 400;
        let month = i64::from(self.month) + if self.month > 2 { -3 } else { 9 };
        let day_of_year = (153 * month + 2) / 5 + i64::from(self.day) - 1;
        Some(era * 146097 + year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year)
    }
}

/// Actual local date/time fields; do not round historical seconds offsets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CivilDateTime {
    /// Astronomical local date.
    pub date: CivilDate,
    /// Hour in 0..24.
    pub hour: u8,
    /// Minute in 0..60.
    pub minute: u8,
    /// Second in 0..60; JavaScript Date does not represent leap seconds.
    pub second: u8,
    /// Millisecond in 0..1000.
    pub millisecond: u16,
}
impl CivilDateTime {
    fn utc_millis(self) -> Result<i64, CalendarProblem> {
        let ordinal = self
            .date
            .ordinal()
            .ok_or(CalendarProblem::InvalidCivilDate(self.date))?;
        if self.hour >= 24 || self.minute >= 60 || self.second >= 60 || self.millisecond >= 1000 {
            return Err(CalendarProblem::InvalidLocalTime(self));
        }
        Ok((ordinal - 719468) * 86_400_000
            + i64::from(self.hour) * 3_600_000
            + i64::from(self.minute) * 60_000
            + i64::from(self.second) * 1000
            + i64::from(self.millisecond))
    }
}

/// Observation after an actual Date clone.setHours(0,0,0,0), not a due bucket.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NormalizedMidnight {
    /// A genuine normalization can fail TimeClip although the original Date is valid.
    Invalid,
    /// The actual resulting instant and normalized local fields, including DST gaps.
    Valid {
        /// Integer milliseconds since the Unix epoch.
        instant_ms: i64,
        /// Actual normalized fields; midnight need not have hour zero.
        local: CivilDateTime,
    },
}

/// Raw host-owned Date facts; this does not certify an IANA timezone authority.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DateObservation {
    /// Actual integer Date.getTime(), within JavaScript TimeClip bounds.
    pub instant_ms: i64,
    /// Actual getters from that Date, without UTC-date substitution.
    pub local: CivilDateTime,
    /// Actual clone.setHours normalization; never inferred from the civil date.
    pub start_of_day: NormalizedMidnight,
}

/// Parsed invalid dates differ from valid dates whose normalized midnight is invalid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParsedDueDate {
    /// The actual host Date parser rejected this exact string.
    Invalid,
    /// Raw observations from the actual parsed Date.
    Valid(DateObservation),
}

/// Clock/date observations sampled for this planning call, without a timer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChecklistCalendar {
    /// Actual current Date at the planning memo evaluation.
    pub today: DateObservation,
    /// Exact effective due string to its actual host parse result.
    pub due_dates: BTreeMap<String, ParsedDueDate>,
}

const TIME_CLIP: i64 = 8_640_000_000_000_000;
fn validate_date(instant_ms: i64, local: CivilDateTime) -> Result<(), CalendarProblem> {
    if !(-TIME_CLIP..=TIME_CLIP).contains(&instant_ms) {
        return Err(CalendarProblem::InvalidInstant(instant_ms));
    }
    local.utc_millis()?;
    Ok(())
}

// Reproduce the actual date-fns UTC constructor followed by setUTCFullYear.
// Date.UTC remaps 0..99 before normalizing; year zero's February 29 rolls
// into March in 1900 and remains March when the setter restores year zero.
fn source_utc_time(mut local: CivilDateTime) -> Result<Option<i64>, CalendarProblem> {
    let year = local.date.year;
    if (0..=99).contains(&year) {
        local.date.year += 1900;
        if year == 0 && local.date.month == 2 && local.date.day == 29 {
            local.date.month = 3;
            local.date.day = 1;
        }
    }
    if !(-TIME_CLIP..=TIME_CLIP).contains(&local.utc_millis()?) {
        // setUTCFullYear on an invalid Date starts from +0 (January 1, 1970).
        local = CivilDateTime {
            date: CivilDate {
                year,
                month: 1,
                day: 1,
            },
            hour: 0,
            minute: 0,
            second: 0,
            millisecond: 0,
        };
    } else {
        local.date.year = year;
    }
    let millis = local.utc_millis()?;
    Ok((-TIME_CLIP..=TIME_CLIP).contains(&millis).then_some(millis))
}
fn source_day_time(date: &DateObservation) -> Result<Option<f64>, CalendarProblem> {
    validate_date(date.instant_ms, date.local)?;
    match date.start_of_day {
        NormalizedMidnight::Invalid => Ok(None),
        NormalizedMidnight::Valid { instant_ms, local } => {
            validate_date(instant_ms, local)?;
            // Keep the source float operations, including historical offset seconds.
            Ok(source_utc_time(local)?.map(|utc| {
                let instant = instant_ms as f64;
                instant - (instant - utc as f64)
            }))
        }
    }
}

/// One metadata row after real task properties have been merged.
#[derive(Clone, Debug, PartialEq)]
pub struct EffectiveItem {
    /// Preserve metadata identity and row ordering.
    pub key: NodeKey,
    /// Leading wrappers travel with this item.
    pub leading_keys: Vec<NodeKey>,
    /// Attached wrappers travel with this item.
    pub attached_keys: Vec<NodeKey>,
    /// Existing collected text; planning does not trim it again.
    pub text: String,
    /// The document checkbox remains independent of task status.
    pub checked: bool,
    /// Task status, falling back to the actual checkbox.
    pub status: TaskStatus,
    /// Task priority, falling back to the collected marker.
    pub priority: Option<TaskPriority>,
    /// Task assignments replace inline mentions only when nonempty.
    pub assignees: Vec<ChecklistAssignee>,
    /// Nullish task dates fall back to collected mention facts.
    pub due: Maybe<String>,
}

/// Canonical filter arrays preserve unknown strings, duplicates and input order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaskListFilters {
    /// OR within status choices.
    pub status: Vec<String>,
    /// OR within priority choices, including none.
    pub priority: Vec<String>,
    /// OR within IDs, or unassigned for an empty assignment list.
    pub assignees: Vec<String>,
    /// OR within due buckets, including none.
    pub due: Vec<String>,
}
impl TaskListFilters {
    /// Count choices, including duplicates, rather than engaged categories.
    pub fn active_count(&self) -> usize {
        self.status.len() + self.priority.len() + self.assignees.len() + self.due.len()
    }
}

/// Source-normalized settings contain exactly the four known filter arrays.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NormalizedSettings {
    /// Missing/null arrays become empty; the original stored object is untouched.
    pub filters: TaskListFilters,
}

/// An ordinary item or wrapper to dim, in original source traversal order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChecklistRowPlan {
    /// Actual collected row identity.
    pub key: NodeKey,
    /// Filters dim rows; they do not remove them or alter progress.
    pub dimmed: bool,
}

/// Progress ignores only exact empty text, regardless of active filters.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ChecklistProgress {
    /// Checked items and done/canceled tasks.
    pub done: usize,
    /// Nonempty items, without counting wrapper rows.
    pub total: usize,
}
impl ChecklistProgress {
    /// The source bar renders zero for an empty list, never NaN.
    pub fn completion_ratio(self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            self.done as f64 / self.total as f64
        }
    }
    /// Source Math.round percentage, returned as a number for host presentation.
    pub fn percentage(self) -> f64 {
        (self.completion_ratio() * 100.0).round()
    }
}

/// Pure derived facts; no editor writes, query registration or host activation.
#[derive(Clone, Debug, PartialEq)]
pub struct ChecklistPlan {
    /// Effective item facts preserve collected item order.
    pub items: Vec<EffectiveItem>,
    /// Canonical normalized filters; raw state remains separately owned.
    pub settings: NormalizedSettings,
    /// Leading, ordinary and attached rows in source order, including repeats.
    pub rows: Vec<ChecklistRowPlan>,
    /// At least one selected filter choice.
    pub active: bool,
    /// Count of selected choices, not distinct values.
    pub filter_count: usize,
    /// Source taskId !== null, preserving legacy absent values distinctly.
    pub has_tasks: bool,
    /// Progress over all nonempty items, independent of dimming.
    pub progress: ChecklistProgress,
}

/// A boundary failure is not an ordinary Source planning error or empty result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarProblem {
    /// Host supplied invalid local Gregorian fields.
    InvalidCivilDate(CivilDate),
    /// A host instant violates JavaScript TimeClip bounds.
    InvalidInstant(i64),
    /// Time fields cannot have come from actual Date getters.
    InvalidLocalTime(CivilDateTime),
    /// A due date was actually needed but no parse observation was supplied.
    MissingDueObservation(String),
}

/// Unsupported raw shapes remain an explicit coverage gap, never normalization.
#[derive(Clone, Debug, PartialEq)]
pub enum ChecklistPlanResult {
    /// Canonical filter inputs were fully planned.
    Planned(ChecklistPlan),
    /// Preserve the exact original settings allocation and unsupported input field.
    UnsupportedInput {
        /// Noncanonical settings field or reserved task/option identifier field.
        field: &'static str,
        /// Unmodified stored settings. For external fact gaps this is context,
        /// not a claim that this object contains the unsupported fact.
        raw: Arc<Value>,
    },
    /// Missing or inconsistent host calendar facts cannot become an undated item.
    InvalidCalendarFacts(CalendarProblem),
}

fn normalize(raw: &Arc<Value>) -> Result<NormalizedSettings, &'static str> {
    let object = match raw.as_ref() {
        Value::Null => return Ok(NormalizedSettings::default()),
        Value::Object(object) => object,
        _ => return Err("settings"),
    };
    let filters = match object.get("filters") {
        None | Some(Value::Null) => return Ok(NormalizedSettings::default()),
        Some(Value::Object(filters)) => filters,
        _ => return Err("filters"),
    };
    let array = |field| match filters.get(field) {
        None | Some(Value::Null) => Ok(vec![]),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| value.as_str().map(str::to_owned).ok_or(field))
            .collect(),
        _ => Err(field),
    };
    Ok(NormalizedSettings {
        filters: TaskListFilters {
            status: array("status")?,
            priority: array("priority")?,
            assignees: array("assignees")?,
            due: array("due")?,
        },
    })
}

fn prototype_collision(value: &str) -> bool {
    matches!(
        value,
        "constructor"
            | "__defineGetter__"
            | "__defineSetter__"
            | "hasOwnProperty"
            | "__lookupGetter__"
            | "__lookupSetter__"
            | "isPrototypeOf"
            | "propertyIsEnumerable"
            | "toString"
            | "valueOf"
            | "__proto__"
            | "toLocaleString"
    )
}

fn status(option: Option<&str>) -> Option<TaskStatus> {
    match option? {
        "00000001-0000-0000-0002-000000000001" => Some(TaskStatus::NotStarted),
        "00000001-0000-0000-0002-000000000002" => Some(TaskStatus::InProgress),
        "00000001-0000-0000-0002-000000000003" => Some(TaskStatus::InReview),
        "00000001-0000-0000-0002-000000000004" => Some(TaskStatus::Done),
        "00000001-0000-0000-0002-000000000005" => Some(TaskStatus::Canceled),
        _ => None,
    }
}
fn priority(option: Option<&str>) -> Option<TaskPriority> {
    match option? {
        "00000001-0000-0000-0003-000000000001" => Some(TaskPriority::Low),
        "00000001-0000-0000-0003-000000000002" => Some(TaskPriority::Medium),
        "00000001-0000-0000-0003-000000000003" => Some(TaskPriority::High),
        "00000001-0000-0000-0003-000000000004" => Some(TaskPriority::Urgent),
        _ => None,
    }
}

fn includes(values: &[String], value: &str) -> bool {
    values.iter().any(|entry| entry == value)
}
fn matches(
    item: &EffectiveItem,
    filters: &TaskListFilters,
    calendar: &ChecklistCalendar,
    today: Option<f64>,
) -> Result<bool, CalendarProblem> {
    if !filters.status.is_empty() && !includes(&filters.status, item.status.as_str()) {
        return Ok(false);
    }
    if !filters.priority.is_empty()
        && !includes(
            &filters.priority,
            item.priority.as_ref().map_or("none", AsRef::as_ref),
        )
    {
        return Ok(false);
    }
    if !filters.assignees.is_empty() {
        let assigned = if item.assignees.is_empty() {
            includes(&filters.assignees, "unassigned")
        } else {
            item.assignees.iter().any(|assignee| {
                assignee
                    .id
                    .as_deref()
                    .is_some_and(|id| includes(&filters.assignees, id))
            })
        };
        if !assigned {
            return Ok(false);
        }
    }
    if !filters.due.is_empty() {
        let bucket = match item.due.as_deref().filter(|value| !value.is_empty()) {
            None => "none",
            Some(due) => match calendar.due_dates.get(due) {
                Some(ParsedDueDate::Invalid) => "none",
                Some(ParsedDueDate::Valid(date)) => {
                    match (source_day_time(date)?, today) {
                        (Some(later), Some(earlier)) => {
                            let quotient = (later - earlier) / 86_400_000.0;
                            let floor = quotient.floor();
                            // JS Math.round chooses +infinity at a half, including negatives.
                            let days = if quotient - floor < 0.5 {
                                floor
                            } else {
                                floor + 1.0
                            };
                            if days < 0.0 {
                                "overdue"
                            } else if days == 0.0 {
                                "today"
                            } else if days <= 7.0 {
                                "week"
                            } else {
                                "later"
                            }
                        }
                        // Source NaN comparisons fall through to later, not none/error.
                        _ => "later",
                    }
                }
                None => return Err(CalendarProblem::MissingDueObservation(due.to_owned())),
            },
        };
        if !includes(&filters.due, bucket) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Merge actual task/name facts, normalize canonical filters and plan dimming.
/// Maps are lookup-only; document order, duplicates and unknown strings survive.
pub fn plan_checklist(
    meta: Option<&ChecklistMeta>,
    tasks: &BTreeMap<String, TaskInfo>,
    names: &BTreeMap<String, String>,
    calendar: &ChecklistCalendar,
) -> ChecklistPlanResult {
    let raw = meta.map_or_else(|| Arc::new(Value::Null), |meta| meta.settings.clone());
    let settings = match normalize(&raw) {
        Ok(settings) => settings,
        Err(field) => return ChecklistPlanResult::UnsupportedInput { field, raw },
    };
    let today = match source_day_time(&calendar.today) {
        Ok(today) => today,
        Err(problem) => return ChecklistPlanResult::InvalidCalendarFacts(problem),
    };
    let items = meta
        .into_iter()
        .flat_map(|meta| &meta.items)
        .map(|item| {
            let task_id = item.task_id.as_deref().filter(|id| !id.is_empty());
            if task_id.is_some_and(prototype_collision) {
                return Err("taskId");
            }
            let task = task_id.and_then(|id| tasks.get(id));
            if task
                .and_then(|task| task.status_option_id.as_deref())
                .is_some_and(prototype_collision)
            {
                return Err("task.statusOptionId");
            }
            if task
                .and_then(|task| task.priority_option_id.as_deref())
                .is_some_and(prototype_collision)
            {
                return Err("task.priorityOptionId");
            }
            Ok(EffectiveItem {
                key: item.key,
                leading_keys: item.leading_keys.clone(),
                attached_keys: item.attached_keys.clone(),
                text: item.text.clone(),
                checked: item.checked,
                status: task
                    .and_then(|task| status(task.status_option_id.as_deref()))
                    .unwrap_or(if item.checked {
                        TaskStatus::Done
                    } else {
                        TaskStatus::NotStarted
                    }),
                priority: task
                    .and_then(|task| priority(task.priority_option_id.as_deref()))
                    .or(item.marker_priority),
                assignees: match task.filter(|task| !task.assignee_ids.is_empty()) {
                    Some(task) => task
                        .assignee_ids
                        .iter()
                        .map(|id| ChecklistAssignee {
                            id: Maybe::Value(id.clone()),
                            name: names.get(id).cloned().unwrap_or_else(|| "Unknown".into()),
                        })
                        .collect(),
                    None => item.mention_assignees.clone(),
                },
                due: task
                    .and_then(|task| task.due.as_ref())
                    .map_or_else(|| item.mention_due.clone(), |due| Maybe::Value(due.clone())),
            })
        })
        .collect::<Result<Vec<_>, _>>();
    let items = match items {
        Ok(items) => items,
        Err(field) => return ChecklistPlanResult::UnsupportedInput { field, raw },
    };

    let filter_count = settings.filters.active_count();
    let active = filter_count > 0;
    let mut rows = vec![];
    let mut progress = ChecklistProgress::default();
    for item in &items {
        let dimmed = if active {
            match matches(item, &settings.filters, calendar, today) {
                Ok(matches) => !matches,
                Err(problem) => return ChecklistPlanResult::InvalidCalendarFacts(problem),
            }
        } else {
            false
        };
        rows.extend(
            item.leading_keys
                .iter()
                .chain(std::iter::once(&item.key))
                .chain(&item.attached_keys)
                .map(|key| ChecklistRowPlan { key: *key, dimmed }),
        );
        if !item.text.is_empty() {
            progress.total += 1;
            if item.checked || matches!(item.status, TaskStatus::Done | TaskStatus::Canceled) {
                progress.done += 1;
            }
        }
    }
    let has_tasks = meta.is_some_and(|meta| {
        meta.items
            .iter()
            .any(|item| !matches!(item.task_id, Maybe::Null))
    });
    ChecklistPlanResult::Planned(ChecklistPlan {
        items,
        settings,
        rows,
        active,
        filter_count,
        has_tasks,
        progress,
    })
}
