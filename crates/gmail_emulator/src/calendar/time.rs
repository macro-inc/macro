//! Event times, and the occurrences of a recurring event.

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, Utc};
use chrono_tz::Tz;
use rrule::RRuleSet;
use serde_json::{Map, Value, json};

use crate::error::ApiError;

const DATE: &str = "%Y-%m-%d";
const LOCAL_DATE_TIME: &str = "%Y-%m-%dT%H:%M:%S";
const COMPACT_DATE: &str = "%Y%m%d";
const COMPACT_DATE_TIME: &str = "%Y%m%dT%H%M%S";
const COMPACT_INSTANT: &str = "%Y%m%dT%H%M%SZ";
/// How many occurrences one expansion yields at most. Google caps a page at
/// 2500 events.
const MAX_OCCURRENCES: u16 = 2500;

/// Where an event, or one occurrence of it, starts or ends.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Point {
    /// An instant (`dateTime`).
    Timed(DateTime<Utc>),
    /// A whole day (`date`).
    AllDay(NaiveDate),
}

impl Point {
    /// The instant it names; a day starts at midnight in `zone`.
    pub(crate) fn instant(self, zone: Tz) -> DateTime<Utc> {
        match self {
            Self::Timed(instant) => instant,
            Self::AllDay(date) => date
                .and_time(NaiveTime::MIN)
                .and_local_timezone(zone)
                .earliest()
                .map_or_else(
                    || date.and_time(NaiveTime::MIN).and_utc(),
                    |midnight| midnight.with_timezone(&Utc),
                ),
        }
    }

    /// The suffix Google gives the id of the occurrence starting here:
    /// `<event id>_20261109T140000Z`, or `<event id>_20261109` for a day.
    pub(crate) fn instance_suffix(self) -> String {
        match self {
            Self::Timed(instant) => instant.format(COMPACT_INSTANT).to_string(),
            Self::AllDay(date) => date.format(COMPACT_DATE).to_string(),
        }
    }

    /// The start an instance id's suffix names.
    pub(crate) fn from_instance_suffix(suffix: &str) -> Option<Self> {
        if let Ok(instant) = NaiveDateTime::parse_from_str(suffix, COMPACT_INSTANT) {
            return Some(Self::Timed(instant.and_utc()));
        }
        NaiveDate::parse_from_str(suffix, COMPACT_DATE)
            .ok()
            .map(Self::AllDay)
    }

    /// The object Google answers: a `dateTime` in `display`, or a `date`.
    pub(crate) fn json(self, display: Tz, named_zone: Option<Tz>) -> Value {
        match self {
            Self::Timed(instant) => {
                let local = instant.with_timezone(&display);
                let mut time = json!({
                    "dateTime": local.to_rfc3339_opts(SecondsFormat::Secs, true),
                });
                if let Some(zone) = named_zone {
                    time["timeZone"] = json!(zone.name());
                }
                time
            }
            Self::AllDay(date) => json!({ "date": date.format(DATE).to_string() }),
        }
    }
}

/// Reads a `start`, `end` or `originalStartTime` object, with the time
/// zone it names.
pub(crate) fn parse_point(value: &Value) -> Option<(Point, Option<Tz>)> {
    let zone = value
        .get("timeZone")
        .and_then(Value::as_str)
        .and_then(|zone| zone.parse::<Tz>().ok());

    if let Some(date_time) = value.get("dateTime").and_then(Value::as_str) {
        if let Ok(instant) = DateTime::parse_from_rfc3339(date_time) {
            return Some((Point::Timed(instant.with_timezone(&Utc)), zone));
        }
        // A local time is read in the zone beside it, as Google does.
        let local = NaiveDateTime::parse_from_str(date_time, LOCAL_DATE_TIME).ok()?;
        let instant = local.and_local_timezone(zone?).earliest()?;
        return Some((Point::Timed(instant.with_timezone(&Utc)), zone));
    }

    let date = value.get("date").and_then(Value::as_str)?;
    let date = NaiveDate::parse_from_str(date, DATE).ok()?;
    Some((Point::AllDay(date), zone))
}

/// When an event happens.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Span {
    pub(crate) start: Point,
    pub(crate) end: Point,
    /// The zone `start` names, which a recurrence repeats in.
    pub(crate) zone: Option<Tz>,
    /// The zone `end` names.
    pub(crate) end_zone: Option<Tz>,
}

impl Span {
    /// Reads an event's `start` and `end`, refusing what Google refuses.
    pub(crate) fn of(fields: &Map<String, Value>) -> Result<Self, ApiError> {
        let start = fields
            .get("start")
            .ok_or_else(|| ApiError::calendar(400, "required", "Missing start time."))?;
        let end = fields
            .get("end")
            .ok_or_else(|| ApiError::calendar(400, "required", "Missing end time."))?;
        let invalid = || ApiError::calendar(400, "invalid", "Invalid start time.");
        let (start, zone) = parse_point(start).ok_or_else(invalid)?;
        let (end, end_zone) = parse_point(end).ok_or_else(invalid)?;

        let ordered = match (start, end) {
            (Point::Timed(start), Point::Timed(end)) => start <= end,
            (Point::AllDay(start), Point::AllDay(end)) => start <= end,
            (Point::Timed(_), Point::AllDay(_)) | (Point::AllDay(_), Point::Timed(_)) => {
                return Err(ApiError::calendar(
                    400,
                    "invalid",
                    "Start and end times must either both be date or both be dateTime.",
                ));
            }
        };
        if !ordered {
            return Err(ApiError::calendar(
                400,
                "timeRangeEmpty",
                "The specified time range is empty.",
            ));
        }

        Ok(Self {
            start,
            end,
            zone,
            end_zone,
        })
    }

    /// The same event, moved to start at `start`.
    pub(crate) fn starting_at(self, start: Point) -> Self {
        let end = match (self.start, self.end, start) {
            (Point::Timed(first), Point::Timed(end), Point::Timed(start)) => {
                Point::Timed(start + (end - first))
            }
            (Point::AllDay(first), Point::AllDay(end), Point::AllDay(start)) => {
                Point::AllDay(start + (end - first))
            }
            _ => self.end,
        };
        Self { start, end, ..self }
    }

    /// Whether it lies in a window, as `events.list` reads `timeMin` and
    /// `timeMax`: it ends after the lower bound and starts before the upper.
    pub(crate) fn overlaps(self, window: Window, all_day_zone: Tz) -> bool {
        let starts_before = window
            .until
            .is_none_or(|until| self.start.instant(all_day_zone) < until);
        let ends_after = window
            .from
            .is_none_or(|from| self.end.instant(all_day_zone) > from);
        starts_before && ends_after
    }
}

/// `timeMin` and `timeMax`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Window {
    pub(crate) from: Option<DateTime<Utc>>,
    pub(crate) until: Option<DateTime<Utc>>,
}

/// Why a recurrence could not be expanded.
#[derive(Debug, thiserror::Error)]
#[error("invalid recurrence: {0}")]
pub(crate) struct RecurrenceError(#[from] rrule::RRuleError);

impl From<RecurrenceError> for ApiError {
    fn from(error: RecurrenceError) -> Self {
        ApiError::calendar(400, "invalid", &format!("Invalid recurrence rule. {error}"))
    }
}

/// The starts of a recurring event's occurrences that can lie in `window`,
/// in order. A window open at the end yields at most a page of them.
///
/// The rule repeats in the zone the event's start names, so an event at
/// 09:00 in New York stays at 09:00 across a daylight-saving change. Each
/// start names the occurrence, whether or not an exception has since moved or
/// cancelled it.
pub(crate) fn occurrence_starts(
    span: Span,
    recurrence: &[String],
    window: Window,
) -> Result<Vec<Point>, RecurrenceError> {
    // A day-valued start repeats by date, in no zone.
    let start_line = match (span.start, span.zone) {
        (Point::AllDay(date), _) => format!("DTSTART;VALUE=DATE:{}", date.format(COMPACT_DATE)),
        (Point::Timed(first), Some(zone)) => format!(
            "DTSTART;TZID={}:{}",
            zone.name(),
            first.with_timezone(&zone).format(COMPACT_DATE_TIME)
        ),
        (Point::Timed(first), None) => format!("DTSTART:{}", first.format(COMPACT_INSTANT)),
    };
    let mut rules: RRuleSet = format!("{start_line}\n{}", recurrence.join("\n"))
        .parse()
        .map_err(RecurrenceError)?;

    // The window is widened by the event's length and a day of zone offset;
    // the caller keeps the occurrences that really overlap it.
    let length = span.end.instant(Tz::UTC) - span.start.instant(Tz::UTC);
    let margin = length + Duration::days(1);
    if let Some(from) = window.from {
        rules = rules.after((from - margin).with_timezone(&rrule::Tz::UTC));
    }
    if let Some(until) = window.until {
        rules = rules.before((until + margin).with_timezone(&rrule::Tz::UTC));
    }

    Ok(rules
        .all(MAX_OCCURRENCES)
        .dates
        .into_iter()
        .map(|start| match span.start {
            Point::AllDay(_) => Point::AllDay(start.date_naive()),
            Point::Timed(_) => Point::Timed(start.with_timezone(&Utc)),
        })
        .collect())
}

#[cfg(test)]
mod test;
