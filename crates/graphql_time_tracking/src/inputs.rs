//! GraphQL inputs and their conversion into domain requests.

#[cfg(test)]
mod test;

use async_graphql::{ID, InputObject, MaybeUndefined};
use chrono::{DateTime, NaiveDate, Utc};
use graphql_common::parse_id;
use time_tracking::domain::models::{
    DEFAULT_PAGE_LIMIT, FieldEdit, MAX_PAGE_LIMIT, NewTimeEntry, StartTimer, StopTimer,
    TimeEntryChanges, TimeEntryCursor, TimeEntryPageRequest, TimeTrackingError, TimerEnding,
    parse_time_zone,
};
use uuid::Uuid;

use crate::bad_input;

/// Typed time to log on a task.
#[derive(InputObject)]
pub struct LogTimeInput {
    /// A UUIDv7 the client chose, so a replayed request logs once.
    pub id: ID,
    /// The task document the time was spent on.
    pub task_id: ID,
    /// The logger's own calendar day for the work, `YYYY-MM-DD`.
    pub date: String,
    /// Length in whole minutes, 1 to 1440.
    pub minutes: i32,
    /// What the time was spent on, up to 2000 characters.
    pub note: Option<String>,
    /// When the work started, RFC 3339; given with `endedAt` or not at all.
    pub started_at: Option<String>,
    /// When the work ended, RFC 3339, after `startedAt`.
    pub ended_at: Option<String>,
}

/// Changes to one's own entry. Omitted fields stay; `null` clears a note or span.
#[derive(InputObject)]
pub struct UpdateTimeEntryInput {
    /// The entry to change.
    pub id: ID,
    /// A new day, `YYYY-MM-DD`.
    pub date: Option<String>,
    /// A new length in whole minutes, 1 to 1440.
    pub minutes: Option<i32>,
    /// A new note, or `null` to remove it.
    pub note: MaybeUndefined<String>,
    /// A new start, RFC 3339, or `null` with `endedAt` to remove the span.
    pub started_at: MaybeUndefined<String>,
    /// A new end, RFC 3339, or `null` with `startedAt` to remove the span.
    pub ended_at: MaybeUndefined<String>,
}

/// One's own entry to delete, and the task it was logged on.
#[derive(InputObject)]
pub struct DeleteTimeEntryInput {
    /// The entry to delete.
    pub id: ID,
    /// The task the entry was logged on, whose Time logged the reply returns.
    pub task_id: ID,
}

/// A task to start timing.
#[derive(InputObject)]
pub struct StartTimerInput {
    /// A UUIDv7 the client chose, so a replayed start starts one timer.
    pub id: ID,
    /// The task document to time.
    pub task_id: ID,
    /// The IANA zone whose day a stopped previous timer's entry takes; UTC when omitted.
    pub time_zone: Option<String>,
    /// An earlier start, RFC 3339, within the last 24 hours; only Undo on a switch sends it.
    pub started_at: Option<String>,
}

/// The viewer's timer to stop, and what to log for it.
#[derive(InputObject)]
pub struct StopTimerInput {
    /// The running timer.
    pub timer_id: ID,
    /// The IANA zone whose day the entry takes; UTC when omitted.
    pub time_zone: Option<String>,
    /// When the person says they stopped, RFC 3339; resolves a timer past the limit.
    pub ended_at: Option<String>,
    /// Log until now however long the timer ran; resolves a timer past the limit.
    pub log_all: Option<bool>,
}

pub(crate) fn parse_date(value: &str, field: &str) -> async_graphql::Result<NaiveDate> {
    value
        .parse::<NaiveDate>()
        .map_err(|_| bad_input(format!("{field} must be a date written YYYY-MM-DD")))
}

fn parse_instant(value: &str, field: &str) -> async_graphql::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|instant| instant.with_timezone(&Utc))
        .map_err(|_| bad_input(format!("{field} must be an RFC 3339 timestamp")))
}

fn parse_optional_instant(
    value: Option<&str>,
    field: &str,
) -> async_graphql::Result<Option<DateTime<Utc>>> {
    value.map(|value| parse_instant(value, field)).transpose()
}

fn parse_minutes(value: i32) -> async_graphql::Result<u16> {
    u16::try_from(value).map_err(|_| bad_input("minutes must be a whole number from 1 to 1440"))
}

fn instant_edit(
    value: MaybeUndefined<String>,
    field: &str,
) -> async_graphql::Result<FieldEdit<DateTime<Utc>>> {
    Ok(match value {
        MaybeUndefined::Undefined => FieldEdit::Keep,
        MaybeUndefined::Null => FieldEdit::Clear,
        MaybeUndefined::Value(value) => FieldEdit::Set(parse_instant(&value, field)?),
    })
}

fn time_zone_error(error: TimeTrackingError) -> async_graphql::Error {
    bad_input(error.to_string())
}

impl LogTimeInput {
    /// The task id and the entry to log.
    pub(crate) fn into_domain(self) -> async_graphql::Result<(String, NewTimeEntry)> {
        Ok((
            self.task_id.to_string(),
            NewTimeEntry {
                id: Some(parse_id(self.id, "id")?),
                date: parse_date(&self.date, "date")?,
                minutes: parse_minutes(self.minutes)?,
                note: self.note,
                started_at: parse_optional_instant(self.started_at.as_deref(), "startedAt")?,
                ended_at: parse_optional_instant(self.ended_at.as_deref(), "endedAt")?,
            },
        ))
    }
}

impl UpdateTimeEntryInput {
    /// The entry id and its changes.
    pub(crate) fn into_domain(self) -> async_graphql::Result<(Uuid, TimeEntryChanges)> {
        Ok((
            parse_id(self.id, "id")?,
            TimeEntryChanges {
                date: self
                    .date
                    .as_deref()
                    .map(|date| parse_date(date, "date"))
                    .transpose()?,
                minutes: self.minutes.map(parse_minutes).transpose()?,
                note: match self.note {
                    MaybeUndefined::Undefined => FieldEdit::Keep,
                    MaybeUndefined::Null => FieldEdit::Clear,
                    MaybeUndefined::Value(note) => FieldEdit::Set(note),
                },
                started_at: instant_edit(self.started_at, "startedAt")?,
                ended_at: instant_edit(self.ended_at, "endedAt")?,
            },
        ))
    }
}

impl DeleteTimeEntryInput {
    /// The entry id and the task id.
    pub(crate) fn into_domain(self) -> async_graphql::Result<(Uuid, String)> {
        Ok((parse_id(self.id, "id")?, self.task_id.to_string()))
    }
}

impl StartTimerInput {
    /// The task id and the start.
    pub(crate) fn into_domain(self) -> async_graphql::Result<(String, StartTimer)> {
        Ok((
            self.task_id.to_string(),
            StartTimer {
                id: Some(parse_id(self.id, "id")?),
                time_zone: parse_time_zone(self.time_zone.as_deref()).map_err(time_zone_error)?,
                started_at: parse_optional_instant(self.started_at.as_deref(), "startedAt")?,
            },
        ))
    }
}

impl StopTimerInput {
    /// The stop request.
    pub(crate) fn into_domain(self) -> async_graphql::Result<StopTimer> {
        let ended_at = parse_optional_instant(self.ended_at.as_deref(), "endedAt")?;
        Ok(StopTimer {
            timer_id: parse_id(self.timer_id, "timerId")?,
            time_zone: parse_time_zone(self.time_zone.as_deref()).map_err(time_zone_error)?,
            ending: TimerEnding::from_request(ended_at, self.log_all.unwrap_or(false))
                .map_err(|error| bad_input(error.to_string()))?,
        })
    }
}

/// Read a page request: `limit` defaults to the domain's page size, and
/// `after` is a cursor a previous page returned.
pub(crate) fn page_request(
    limit: Option<i32>,
    after: Option<&str>,
) -> async_graphql::Result<TimeEntryPageRequest> {
    let limit = graphql_common::parse_limit(
        limit,
        i32::from(DEFAULT_PAGE_LIMIT),
        i32::from(MAX_PAGE_LIMIT),
    )?;
    Ok(TimeEntryPageRequest {
        limit: Some(u8::try_from(limit).map_err(|_| bad_input("limit is out of range"))?),
        after: after.map(decode_cursor).transpose()?,
    })
}

/// The opaque cursor a page returns for the page after it.
pub(crate) fn encode_cursor(cursor: TimeEntryCursor) -> async_graphql::Result<String> {
    serde_json::to_string(&cursor).map_err(|error| {
        tracing::error!(error = ?error, "time entry cursor did not serialize");
        async_graphql::Error::new("internal server error")
    })
}

fn decode_cursor(cursor: &str) -> async_graphql::Result<TimeEntryCursor> {
    serde_json::from_str(cursor).map_err(|_| bad_input("after is not a cursor this field returned"))
}
