//! Time entries, the running timer, and the rules both follow.

#[cfg(test)]
mod test;

use chrono::{DateTime, Months, NaiveDate, SubsecRound, TimeDelta, Utc};
use chrono_tz::Tz;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The longest single entry, typed or timed: 24 hours.
pub const MAX_ENTRY_MINUTES: u16 = 24 * 60;

/// The longest note on an entry, in characters. The table checks the same bound.
pub const MAX_NOTE_CHARS: usize = 2000;

/// A timer that has run longer than this is not stopped until the person says
/// what to log: when they stopped, all of it, or nothing.
pub const TIMER_LIMIT: TimeDelta = TimeDelta::hours(8);

/// How far back a timer's start may be set, which only Undo on a switch does.
pub const STARTED_AT_LOOKBACK: TimeDelta = TimeDelta::hours(24);

/// Entries listed per page when the caller names no limit.
pub const DEFAULT_PAGE_LIMIT: u8 = 50;

/// The most entries one page may list.
pub const MAX_PAGE_LIMIT: u8 = 200;

/// What [`TimeTrackingError::NotFound`] names when time tracking is off for
/// the caller, so adapters can tell it from a missing task.
pub const TIME_TRACKING_OFF: &str = "time tracking";

/// The finest instant the tables store: Postgres keeps microseconds.
const STORED_PRECISION: u16 = 6;

/// An instant as the tables store it, so a comparison made before a write
/// still holds after it.
fn stored(instant: DateTime<Utc>) -> DateTime<Utc> {
    instant.trunc_subsecs(STORED_PRECISION)
}

/// How far ahead of today an entry may be dated.
const LATEST_ENTRY_MONTHS_AHEAD: Months = Months::new(12);

/// The earliest day an entry may be dated.
pub fn earliest_entry_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2000, 1, 1).unwrap_or(NaiveDate::MIN)
}

/// Only the person who logged an entry may change or delete it, whatever their
/// access to the task beyond viewing it.
pub fn may_change_entry(entry: &TimeEntry, caller: &MacroUserIdStr<'_>) -> bool {
    entry.user_id.as_ref() == caller.as_ref()
}

/// How a time entry was made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "toolset", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "time_entry_source", rename_all = "lowercase")
)]
#[serde(rename_all = "camelCase")]
pub enum TimeEntrySource {
    /// Typed by a person.
    Manual,
    /// Saved when a timer stopped.
    Timer,
}

/// Time a person logged on a task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    /// The entry's id; a timer's entry keeps the timer's id.
    pub id: Uuid,
    /// The task document the time was spent on.
    pub task_id: String,
    /// Who logged it.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'static>,
    /// The logger's own calendar day for the work.
    pub date: NaiveDate,
    /// Length in whole minutes; the truth even when a start and end are given.
    pub minutes: u16,
    /// What the time was spent on.
    pub note: Option<String>,
    /// When the work started, if known.
    pub started_at: Option<DateTime<Utc>>,
    /// When the work ended, given exactly when `started_at` is.
    pub ended_at: Option<DateTime<Utc>>,
    /// How the entry was made.
    pub source: TimeEntrySource,
    /// When it was logged.
    pub created_at: DateTime<Utc>,
    /// When it last changed.
    pub updated_at: DateTime<Utc>,
}

/// An entry and its task's Time logged after the write that returned it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct LoggedTime {
    /// The entry as stored.
    pub entry: TimeEntry,
    /// The task's Time logged, in minutes.
    pub total_minutes: u32,
}

/// A task's Time logged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TaskTimeTotal {
    /// The task's Time logged, in minutes.
    pub total_minutes: u32,
}

/// Where a page of entries continues: after this day and id, newest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryCursor {
    /// The day of the last entry returned.
    pub date: NaiveDate,
    /// The id of the last entry returned.
    pub id: Uuid,
}

/// Which page of a task's entries to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TimeEntryPageRequest {
    /// Entries per page; [`DEFAULT_PAGE_LIMIT`] when absent.
    pub limit: Option<u8>,
    /// Continue after this entry.
    pub after: Option<TimeEntryCursor>,
}

/// A task's entries, newest day first, with its Time logged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryPage {
    /// Entries of this page.
    pub entries: Vec<TimeEntry>,
    /// The task's Time logged, in minutes.
    pub total_minutes: u32,
    /// Where the next page starts; absent on the last page.
    pub next_cursor: Option<TimeEntryCursor>,
}

/// When typed work started and ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntrySpan {
    /// Start of the work.
    pub started_at: DateTime<Utc>,
    /// End of the work, after the start.
    pub ended_at: DateTime<Utc>,
}

impl EntrySpan {
    /// Pair a start and an end, both or neither, the end after the start at
    /// the precision the table stores.
    pub fn from_parts(
        started_at: Option<DateTime<Utc>>,
        ended_at: Option<DateTime<Utc>>,
    ) -> Result<Option<Self>, TimeTrackingError> {
        match (started_at.map(stored), ended_at.map(stored)) {
            (None, None) => Ok(None),
            (Some(started_at), Some(ended_at)) if ended_at > started_at => Ok(Some(Self {
                started_at,
                ended_at,
            })),
            (Some(_), Some(_)) => Err(TimeTrackingError::InvalidInput(
                "the end must be after the start".to_string(),
            )),
            _ => Err(TimeTrackingError::InvalidInput(
                "give both a start and an end, or neither".to_string(),
            )),
        }
    }
}

/// Time a person types on a task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewTimeEntry {
    /// Client-chosen id, so a retried request logs nothing twice.
    pub id: Option<Uuid>,
    /// The day the work belongs to.
    pub date: NaiveDate,
    /// Length in whole minutes.
    pub minutes: u16,
    /// What the time was spent on.
    pub note: Option<String>,
    /// When the work started, if the person said.
    pub started_at: Option<DateTime<Utc>>,
    /// When the work ended, if the person said.
    pub ended_at: Option<DateTime<Utc>>,
}

/// One field of an edit: left as it is, cleared, or set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FieldEdit<T> {
    /// Keep the stored value.
    #[default]
    Keep,
    /// Remove the stored value.
    Clear,
    /// Store this value.
    Set(T),
}

impl<T> FieldEdit<T> {
    /// Read an optional, nullable request field: absent keeps, `null` clears.
    pub fn from_nullable(field: Option<Option<T>>) -> Self {
        match field {
            None => Self::Keep,
            Some(None) => Self::Clear,
            Some(Some(value)) => Self::Set(value),
        }
    }

    fn apply(self, stored: Option<T>) -> Option<T> {
        match self {
            Self::Keep => stored,
            Self::Clear => None,
            Self::Set(value) => Some(value),
        }
    }
}

/// Changes to an entry; every field is optional.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TimeEntryChanges {
    /// A new day.
    pub date: Option<NaiveDate>,
    /// A new length.
    pub minutes: Option<u16>,
    /// A new note, or none.
    pub note: FieldEdit<String>,
    /// A new start; changed together with `ended_at`.
    pub started_at: FieldEdit<DateTime<Utc>>,
    /// A new end; changed together with `started_at`.
    pub ended_at: FieldEdit<DateTime<Utc>>,
}

/// The editable values of an entry, validated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryValues {
    /// The day the work belongs to.
    pub date: NaiveDate,
    /// Length in whole minutes.
    pub minutes: u16,
    /// What the time was spent on.
    pub note: Option<String>,
    /// When the work started and ended.
    pub span: Option<EntrySpan>,
}

impl EntryValues {
    /// Validate typed values against the entry rules, `today` being the
    /// server's UTC day.
    pub fn validate(
        date: NaiveDate,
        minutes: u16,
        note: Option<String>,
        span: Option<EntrySpan>,
        today: NaiveDate,
    ) -> Result<Self, TimeTrackingError> {
        Ok(Self {
            date: validate_date(date, today)?,
            minutes: validate_minutes(minutes)?,
            note: validate_note(note)?,
            span,
        })
    }

    /// The stored entry with `changes` applied, validated.
    pub fn edited(
        entry: &TimeEntry,
        changes: TimeEntryChanges,
        today: NaiveDate,
    ) -> Result<Self, TimeTrackingError> {
        let span = EntrySpan::from_parts(
            changes.started_at.apply(entry.started_at),
            changes.ended_at.apply(entry.ended_at),
        )?;
        Self::validate(
            changes.date.unwrap_or(entry.date),
            changes.minutes.unwrap_or(entry.minutes),
            changes.note.apply(entry.note.clone()),
            span,
            today,
        )
    }
}

fn validate_minutes(minutes: u16) -> Result<u16, TimeTrackingError> {
    if minutes == 0 || minutes > MAX_ENTRY_MINUTES {
        return Err(TimeTrackingError::InvalidInput(format!(
            "an entry is between 1 minute and {} hours",
            MAX_ENTRY_MINUTES / 60
        )));
    }
    Ok(minutes)
}

fn validate_date(date: NaiveDate, today: NaiveDate) -> Result<NaiveDate, TimeTrackingError> {
    let latest = today
        .checked_add_months(LATEST_ENTRY_MONTHS_AHEAD)
        .unwrap_or(NaiveDate::MAX);
    if date < earliest_entry_date() || date > latest {
        return Err(TimeTrackingError::InvalidInput(format!(
            "an entry is dated from {} to {latest}",
            earliest_entry_date()
        )));
    }
    Ok(date)
}

fn validate_note(note: Option<String>) -> Result<Option<String>, TimeTrackingError> {
    let Some(note) = note else {
        return Ok(None);
    };
    let trimmed = note.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.contains('\0') {
        return Err(TimeTrackingError::InvalidInput(
            "a note cannot contain the NUL character".to_string(),
        ));
    }
    if trimmed.chars().count() > MAX_NOTE_CHARS {
        return Err(TimeTrackingError::InvalidInput(format!(
            "a note is at most {MAX_NOTE_CHARS} characters"
        )));
    }
    Ok(Some(trimmed.to_string()))
}

/// An entry ready to store: an entry the domain validated, or a stopped timer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEntryRow {
    /// The entry's id.
    pub id: Uuid,
    /// The task document.
    pub task_id: String,
    /// Who logged it.
    pub user_id: MacroUserIdStr<'static>,
    /// Its values.
    pub values: EntryValues,
    /// How it was made.
    pub source: TimeEntrySource,
}

/// A person's running timer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct RunningTimer {
    /// The timer's id, kept by the entry it becomes.
    pub id: Uuid,
    /// The task being timed.
    pub task_id: String,
    /// When it started, by the server's clock.
    pub started_at: DateTime<Utc>,
}

/// The caller's timer, if any, and the server's clock to count it from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    /// The running timer.
    pub timer: Option<RunningTimer>,
    /// The server's current time.
    pub server_now: DateTime<Utc>,
}

/// A request to start timing a task.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StartTimer {
    /// Client-chosen id, so a retried start starts one timer.
    pub id: Option<Uuid>,
    /// The zone whose calendar day a stopped previous timer's entry takes.
    pub time_zone: Option<Tz>,
    /// An earlier start, within [`STARTED_AT_LOOKBACK`]; only Undo sends it.
    pub started_at: Option<DateTime<Utc>>,
}

/// A started timer, and the entry saved for the timer it replaced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct StartedTimer {
    /// The timer now running.
    pub timer: RunningTimer,
    /// The previous timer's saved entry, when starting stopped one.
    pub stopped: Option<LoggedTime>,
}

/// What a stopped timer logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimerEnding {
    /// Until now. Refused for a timer past [`TIMER_LIMIT`].
    #[default]
    Now,
    /// Until the time the person says they stopped.
    At(DateTime<Utc>),
    /// Until now, however long the timer ran, up to [`MAX_ENTRY_MINUTES`].
    LogAll,
}

impl TimerEnding {
    /// Read a stop request's resolution: a stop time or "log all", not both.
    pub fn from_request(
        ended_at: Option<DateTime<Utc>>,
        log_all: bool,
    ) -> Result<Self, TimeTrackingError> {
        match (ended_at, log_all) {
            (None, false) => Ok(Self::Now),
            (None, true) => Ok(Self::LogAll),
            (Some(ended_at), false) => Ok(Self::At(ended_at)),
            (Some(_), true) => Err(TimeTrackingError::InvalidInput(
                "give a stop time or log all of it, not both".to_string(),
            )),
        }
    }
}

/// A request to stop the caller's timer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StopTimer {
    /// The timer to stop.
    pub timer_id: Uuid,
    /// The zone whose calendar day the entry takes; UTC when absent.
    pub time_zone: Option<Tz>,
    /// What to log.
    pub ending: TimerEnding,
}

/// The entry a stop saved, or none when the timer was discarded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct StoppedTimer {
    /// The saved entry and its task's Time logged.
    pub logged: Option<LoggedTime>,
}

/// Read an IANA zone name; absent or empty means UTC.
pub fn parse_time_zone(name: Option<&str>) -> Result<Option<Tz>, TimeTrackingError> {
    match name.map(str::trim) {
        None | Some("") => Ok(None),
        Some(name) => name
            .parse::<Tz>()
            .map(Some)
            .map_err(|_| TimeTrackingError::InvalidInput(format!("unknown time zone: {name}"))),
    }
}

/// The entry a timer logs when it stops at `now` with `ending`.
///
/// A timer past [`TIMER_LIMIT`] is refused unless the person said what to log.
/// The entry is at least one minute, rounded to the nearest minute, dated by
/// the start in `time_zone`, so work begun before midnight stays on its day.
/// A clock that reads at or before the start (another server's clock, a few
/// milliseconds behind) ends the span just after it.
pub fn finish_timer(
    timer: &RunningTimer,
    user_id: &MacroUserIdStr<'static>,
    now: DateTime<Utc>,
    ending: TimerEnding,
    time_zone: Option<Tz>,
) -> Result<NewEntryRow, TimeTrackingError> {
    let ended_at = match ending {
        TimerEnding::Now if now - timer.started_at > TIMER_LIMIT => {
            return Err(TimeTrackingError::TimerOverLimit(timer.clone()));
        }
        TimerEnding::Now | TimerEnding::LogAll => {
            stored(now).max(timer.started_at + TimeDelta::microseconds(1))
        }
        TimerEnding::At(ended_at) if stored(ended_at) > timer.started_at && ended_at <= now => {
            stored(ended_at)
        }
        TimerEnding::At(_) => {
            return Err(TimeTrackingError::InvalidInput(
                "the stop time must be after the timer started and not in the future".to_string(),
            ));
        }
    };

    let seconds = (ended_at - timer.started_at).num_seconds();
    let rounded_minutes = ((seconds + 30) / 60).max(1);
    let minutes = u16::try_from(rounded_minutes)
        .ok()
        .filter(|minutes| *minutes <= MAX_ENTRY_MINUTES)
        .ok_or_else(|| {
            TimeTrackingError::InvalidInput(format!(
                "an entry is at most {} hours: say when you stopped, or discard the timer",
                MAX_ENTRY_MINUTES / 60
            ))
        })?;

    let date = match time_zone {
        Some(zone) => timer.started_at.with_timezone(&zone).date_naive(),
        None => timer.started_at.date_naive(),
    };

    Ok(NewEntryRow {
        id: timer.id,
        task_id: timer.task_id.clone(),
        user_id: user_id.clone(),
        values: EntryValues {
            date,
            minutes,
            note: None,
            span: Some(EntrySpan {
                started_at: timer.started_at,
                ended_at,
            }),
        },
        source: TimeEntrySource::Timer,
    })
}

/// Where a new timer starts: now, or an earlier start within the lookback.
pub fn timer_start(
    requested: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>, TimeTrackingError> {
    match requested.map(stored) {
        None => Ok(stored(now)),
        Some(started_at) if started_at <= now && now - started_at <= STARTED_AT_LOOKBACK => {
            Ok(started_at)
        }
        Some(_) => Err(TimeTrackingError::InvalidInput(format!(
            "a timer's start is within the last {} hours and not in the future",
            STARTED_AT_LOOKBACK.num_hours()
        ))),
    }
}

/// Errors returned by the time tracking domain.
#[derive(Debug, thiserror::Error)]
pub enum TimeTrackingError {
    /// The task, entry or timer does not exist, is not visible to the caller,
    /// or time tracking is off for them.
    #[error("{0} not found")]
    NotFound(&'static str),
    /// The caller can see the entry but did not log it.
    #[error("only the person who logged this time can change or delete it")]
    NotAuthor,
    /// The request breaks an entry or timer rule.
    #[error("{0}")]
    InvalidInput(String),
    /// The timer ran past the limit; the caller must say what to log.
    #[error(
        "the timer has run for more than {} hours: say when you stopped, log all of it, or discard it",
        TIMER_LIMIT.num_hours()
    )]
    TimerOverLimit(RunningTimer),
    /// The id is taken, or the timer changed under the request.
    #[error("{0}")]
    Conflict(&'static str),
    /// Other writes on the same task held it too long; retrying may succeed.
    #[error("the task is busy with other changes; try again")]
    Busy,
    /// Storage or another dependency failed.
    #[error("internal time tracking error")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for TimeTrackingError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}
