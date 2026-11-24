//! Reports over logged time: totals for a period, grouped by person, task or
//! day, and the entries behind them as CSV.
//!
//! A report reads one scope (a project's tasks, the caller's own time, or the
//! caller's team's time), keeps the tasks the caller can see, and sums their
//! entries over the period. Days are the loggers' own calendar days; the
//! server knows no week or time zone here, so the client sends both ends.

#[cfg(test)]
mod test;

use std::cmp::Ordering;

use chrono::NaiveDate;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::models::{TimeEntrySource, TimeTrackingError};

/// The longest period one report reads, both ends included.
pub const MAX_PERIOD_DAYS: u16 = 366;

/// The most tasks one report reads. A project with more, or people who logged
/// time on more in the period, gets a report marked incomplete.
pub const MAX_SCOPE_TASKS: u16 = 5_000;

/// The most entries one export writes.
pub const MAX_EXPORT_ROWS: u16 = 10_000;

/// The most bytes one export writes.
pub const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;

/// View access to a project.
pub type ProjectViewReceipt = EntityAccessReceipt<ViewAccessLevel>;

/// The days a report covers, both ends included.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimePeriod {
    from: NaiveDate,
    to: NaiveDate,
}

impl TimePeriod {
    /// A period from `from` to `to`, at most [`MAX_PERIOD_DAYS`] long.
    pub fn new(from: NaiveDate, to: NaiveDate) -> Result<Self, TimeTrackingError> {
        if to < from {
            return Err(TimeTrackingError::InvalidInput(
                "a period ends on or after the day it starts".to_string(),
            ));
        }
        if (to - from).num_days() >= i64::from(MAX_PERIOD_DAYS) {
            return Err(TimeTrackingError::InvalidInput(format!(
                "a period is at most {MAX_PERIOD_DAYS} days"
            )));
        }
        Ok(Self { from, to })
    }

    /// The first day.
    pub fn from(&self) -> NaiveDate {
        self.from
    }

    /// The last day.
    pub fn to(&self) -> NaiveDate {
        self.to
    }
}

/// What a report's totals are grouped by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum TimeGrouping {
    /// The person who logged the time.
    Person,
    /// The task the time was logged on.
    Task,
    /// The logger's calendar day.
    Day,
}

/// Totals grouped by one dimension, each group optionally split by a second.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeBreakdown {
    group_by: TimeGrouping,
    then_by: Option<TimeGrouping>,
}

impl TimeBreakdown {
    /// Group by `group_by`, then split each group by `then_by`, which must differ.
    pub fn new(
        group_by: TimeGrouping,
        then_by: Option<TimeGrouping>,
    ) -> Result<Self, TimeTrackingError> {
        if then_by == Some(group_by) {
            return Err(TimeTrackingError::InvalidInput(
                "split the groups by a different grouping than the one they are grouped by"
                    .to_string(),
            ));
        }
        Ok(Self { group_by, then_by })
    }

    /// The first grouping.
    pub fn group_by(&self) -> TimeGrouping {
        self.group_by
    }

    /// The grouping each group is split by.
    pub fn then_by(&self) -> Option<TimeGrouping> {
        self.then_by
    }
}

/// Whose time a report reads. Every scope counts only tasks the caller can
/// see that are out of the Trash.
#[derive(Debug, Clone)]
pub enum TimeScope {
    /// Everyone's time on the project's tasks, including people who have since
    /// left the team.
    Project(ProjectViewReceipt),
    /// The caller's own time.
    Mine,
    /// The time of the caller's team's current members, the caller included.
    Team,
}

impl TimeScope {
    /// The scope's name in spans.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Project(_) => "project",
            Self::Mine => "mine",
            Self::Team => "team",
        }
    }
}

/// What one total is for.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "by", rename_all = "camelCase")]
pub enum TimeGroupKey {
    /// One person's time.
    Person {
        /// The person.
        #[serde(rename = "userId")]
        #[cfg_attr(feature = "inbound", schema(value_type = String))]
        user_id: MacroUserIdStr<'static>,
    },
    /// The time on one task.
    Task {
        /// The task document.
        #[serde(rename = "taskId")]
        task_id: String,
    },
    /// The time logged for one day.
    Day {
        /// The loggers' calendar day.
        date: NaiveDate,
    },
}

impl TimeGroupKey {
    fn id(&self) -> &str {
        match self {
            Self::Person { user_id } => user_id.as_ref(),
            Self::Task { task_id } => task_id,
            Self::Day { .. } => "",
        }
    }
}

/// Days in calendar order; people and tasks with the most time first, then by id.
fn report_order(a: (&TimeGroupKey, u32), b: (&TimeGroupKey, u32)) -> Ordering {
    match (a.0, b.0) {
        (TimeGroupKey::Day { date: a }, TimeGroupKey::Day { date: b }) => a.cmp(b),
        (a_key, b_key) => b.1.cmp(&a.1).then_with(|| a_key.id().cmp(b_key.id())),
    }
}

/// A total of minutes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimeTotal {
    /// What the total is for.
    pub key: TimeGroupKey,
    /// Minutes logged.
    pub minutes: u32,
}

/// The total of one group, and its split by the second grouping.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimeGroup {
    /// What the group is for.
    pub key: TimeGroupKey,
    /// Minutes logged in the group.
    pub minutes: u32,
    /// Tasks with time in the group.
    pub task_count: u32,
    /// The group's totals by the second grouping, in report order; empty
    /// without one.
    pub rows: Vec<TimeTotal>,
}

/// The time a scope logged over a period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimeSummary {
    /// The first day of the period.
    pub from: NaiveDate,
    /// The last day of the period.
    pub to: NaiveDate,
    /// Minutes logged in the period.
    pub total_minutes: u32,
    /// Tasks with time in the period.
    pub task_count: u32,
    /// For a project, its tasks the caller can see that are out of the
    /// Trash, with time or not; absent for other scopes.
    pub scope_task_count: Option<u32>,
    /// False when the scope held more than 5,000 tasks and only the first
    /// 5,000 were read.
    pub complete: bool,
    /// Totals by the first grouping, in report order: days in calendar order,
    /// people and tasks with the most time first. For the caller's own and
    /// their team's time grouped by person, every current member has a group,
    /// with or without time.
    pub groups: Vec<TimeGroup>,
    /// Totals by the second grouping across all groups, in report order;
    /// empty without one.
    pub then_totals: Vec<TimeTotal>,
}

/// One sum a report's repository read returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SummarySum {
    /// The whole period.
    Total {
        /// Minutes logged.
        minutes: u32,
        /// Tasks with time.
        task_count: u32,
    },
    /// One group of the first grouping.
    Group {
        /// The group.
        key: TimeGroupKey,
        /// Minutes logged in it.
        minutes: u32,
        /// Tasks with time in it.
        task_count: u32,
    },
    /// One group of the second grouping inside a group of the first.
    Row {
        /// The first grouping's group.
        group: TimeGroupKey,
        /// The second grouping's group.
        key: TimeGroupKey,
        /// Minutes logged in both.
        minutes: u32,
    },
    /// One group of the second grouping across all groups.
    ThenTotal {
        /// The group.
        key: TimeGroupKey,
        /// Minutes logged in it.
        minutes: u32,
    },
}

/// The person keys of `members` that `present` lacks.
fn missing_members<'a>(
    present: impl Iterator<Item = &'a TimeGroupKey>,
    members: Option<&[MacroUserIdStr<'static>]>,
) -> Vec<TimeGroupKey> {
    let present: Vec<&TimeGroupKey> = present.collect();
    members
        .unwrap_or_default()
        .iter()
        .map(|member| TimeGroupKey::Person {
            user_id: member.clone(),
        })
        .filter(|key| !present.contains(&key))
        .collect()
}

/// Build a summary from the repository's sums. `members`, when given, are the
/// people who get a person group even without time.
pub fn assemble_summary(
    period: TimePeriod,
    breakdown: TimeBreakdown,
    sums: Vec<SummarySum>,
    members: Option<&[MacroUserIdStr<'static>]>,
    scope_task_count: Option<u32>,
    complete: bool,
) -> TimeSummary {
    let mut total_minutes = 0;
    let mut task_count = 0;
    let mut groups: Vec<TimeGroup> = Vec::new();
    let mut rows: Vec<(TimeGroupKey, TimeTotal)> = Vec::new();
    let mut then_totals: Vec<TimeTotal> = Vec::new();

    for sum in sums {
        match sum {
            SummarySum::Total {
                minutes,
                task_count: tasks,
            } => {
                total_minutes = minutes;
                task_count = tasks;
            }
            SummarySum::Group {
                key,
                minutes,
                task_count,
            } => groups.push(TimeGroup {
                key,
                minutes,
                task_count,
                rows: Vec::new(),
            }),
            SummarySum::Row {
                group,
                key,
                minutes,
            } => rows.push((group, TimeTotal { key, minutes })),
            SummarySum::ThenTotal { key, minutes } => then_totals.push(TimeTotal { key, minutes }),
        }
    }

    if breakdown.group_by() == TimeGrouping::Person {
        let missing = missing_members(groups.iter().map(|group| &group.key), members);
        groups.extend(missing.into_iter().map(|key| TimeGroup {
            key,
            minutes: 0,
            task_count: 0,
            rows: Vec::new(),
        }));
    }
    if breakdown.then_by() == Some(TimeGrouping::Person) {
        let missing = missing_members(then_totals.iter().map(|total| &total.key), members);
        then_totals.extend(missing.into_iter().map(|key| TimeTotal { key, minutes: 0 }));
    }

    if breakdown.then_by().is_some() {
        for (group_key, row) in rows {
            if let Some(group) = groups.iter_mut().find(|group| group.key == group_key) {
                group.rows.push(row);
            }
        }
    }
    for group in &mut groups {
        group
            .rows
            .sort_by(|a, b| report_order((&a.key, a.minutes), (&b.key, b.minutes)));
    }
    groups.sort_by(|a, b| report_order((&a.key, a.minutes), (&b.key, b.minutes)));
    then_totals.sort_by(|a, b| report_order((&a.key, a.minutes), (&b.key, b.minutes)));

    TimeSummary {
        from: period.from(),
        to: period.to(),
        total_minutes,
        task_count,
        scope_task_count,
        complete,
        groups,
        then_totals,
    }
}

/// One entry as an export writes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportEntry {
    /// The logger's calendar day.
    pub date: NaiveDate,
    /// Who logged it.
    pub user_id: MacroUserIdStr<'static>,
    /// The task's name.
    pub task_name: String,
    /// Length in whole minutes.
    pub minutes: u16,
    /// What the time was spent on.
    pub note: Option<String>,
    /// How it was made.
    pub source: TimeEntrySource,
}

/// A scope's entries over a period as CSV text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimeExport {
    /// The CSV: one row per entry, oldest day first.
    pub csv: String,
    /// Entries written.
    pub rows: u32,
    /// False when entries were left out: past 10,000 entries or 16 MiB, or
    /// past the first 5,000 tasks of the scope.
    pub complete: bool,
}

/// The export's header row.
const EXPORT_HEADERS: [&str; 7] = [
    "Date", "Person", "Task", "Minutes", "Hours", "Note", "Source",
];

/// A cell written so a spreadsheet shows it as text, never as a formula, by
/// the rule the CRM export follows.
fn safe_cell(value: &str) -> String {
    if value.trim_start().starts_with(['=', '+', '-', '@']) {
        format!("'{value}")
    } else {
        value.to_owned()
    }
}

fn export_record(entry: &ExportEntry) -> [String; 7] {
    [
        entry.date.to_string(),
        entry.user_id.email_str().to_owned(),
        entry.task_name.clone(),
        entry.minutes.to_string(),
        format!("{:.2}", f64::from(entry.minutes) / 60.0),
        entry.note.clone().unwrap_or_default(),
        match entry.source {
            TimeEntrySource::Manual => "typed",
            TimeEntrySource::Timer => "timer",
        }
        .to_string(),
    ]
}

fn csv_line(record: &[String]) -> Result<Vec<u8>, TimeTrackingError> {
    let mut writer = csv::WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record(record.iter().map(|cell| safe_cell(cell)))
        .map_err(|error| {
            TimeTrackingError::Internal(rootcause::Report::new(error).into_dynamic())
        })?;
    writer
        .into_inner()
        .map_err(|error| TimeTrackingError::Internal(rootcause::report!("{error}").into_dynamic()))
}

/// The entries as CSV, at most [`MAX_EXPORT_ROWS`] rows and
/// [`MAX_EXPORT_BYTES`] bytes. `complete` says whether `entries` held every
/// entry of the scope; the caps can only make it false.
pub fn encode_export(
    entries: &[ExportEntry],
    complete: bool,
) -> Result<TimeExport, TimeTrackingError> {
    let headers = EXPORT_HEADERS.map(str::to_owned);
    let mut bytes = csv_line(&headers)?;
    let mut rows: u32 = 0;
    let mut complete = complete;
    for entry in entries {
        if rows >= u32::from(MAX_EXPORT_ROWS) {
            complete = false;
            break;
        }
        let line = csv_line(&export_record(entry))?;
        if bytes.len() + line.len() > MAX_EXPORT_BYTES {
            complete = false;
            break;
        }
        bytes.extend(line);
        rows += 1;
    }
    let csv = String::from_utf8(bytes).map_err(|error| {
        TimeTrackingError::Internal(rootcause::Report::new(error).into_dynamic())
    })?;
    Ok(TimeExport {
        csv,
        rows,
        complete,
    })
}
