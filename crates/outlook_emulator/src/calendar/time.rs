//! Event times as Graph writes and answers them, and the dates a
//! recurrence pattern falls on.

use chrono::{DateTime, Datelike, Days, Duration, Months, NaiveDate, NaiveDateTime, Utc, Weekday};
use chrono_tz::Tz;
use serde_json::{Value, json};

#[cfg(test)]
mod test;

/// Graph's own name for UTC, on meetings Exchange imported from another
/// calendar system's invitation.
const GRAPH_UTC: &str = "tzone://Microsoft/Utc";
const LOCAL_FORMAT: &str = "%Y-%m-%dT%H:%M:%S%.f";
/// The dates one expansion may walk through before it gives up.
const MAX_STEPS: u32 = 20_000;

/// The zone a `timeZone` names. The emulator computes with IANA names only;
/// a Windows name is something a seed gives Graph's answer, not its input.
pub(crate) fn zone(name: &str) -> Option<Tz> {
    if name.eq_ignore_ascii_case("UTC") || name == GRAPH_UTC {
        return Some(chrono_tz::UTC);
    }
    name.parse().ok()
}

/// A `dateTimeTimeZone` as it was written: a local time and the zone it is in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LocalTime {
    pub(crate) local: NaiveDateTime,
    pub(crate) zone: Tz,
}

impl LocalTime {
    /// Reads `{"dateTime": "2026-11-09T10:00:00", "timeZone": "Europe/Paris"}`.
    pub(crate) fn parse(value: &Value) -> Option<Self> {
        let text = value["dateTime"].as_str()?;
        let zone = zone(value["timeZone"].as_str().unwrap_or("UTC"))?;
        if let Ok(instant) = DateTime::parse_from_rfc3339(text) {
            let local = instant.with_timezone(&zone).naive_local();
            return Some(Self { local, zone });
        }
        let local = NaiveDateTime::parse_from_str(text, LOCAL_FORMAT).ok()?;
        Some(Self { local, zone })
    }

    pub(crate) fn instant(&self) -> DateTime<Utc> {
        instant(self.local, self.zone)
    }
}

/// The instant of a local time. A time a clock change skips is read an hour
/// later, and one it repeats as its first pass, as Exchange does.
pub(crate) fn instant(local: NaiveDateTime, zone: Tz) -> DateTime<Utc> {
    let resolve = |local: NaiveDateTime| local.and_local_timezone(zone).earliest();
    resolve(local)
        .or_else(|| resolve(local + Duration::hours(1)))
        .map(|at| at.with_timezone(&Utc))
        .unwrap_or_else(|| local.and_utc())
}

/// A time as Graph answers it without a `Prefer: outlook.timezone` header:
/// in UTC, with seven fractional digits.
pub(crate) fn graph_time(at: DateTime<Utc>) -> Value {
    json!({
        "dateTime": format!("{}.0000000", at.format("%Y-%m-%dT%H:%M:%S")),
        "timeZone": "UTC",
    })
}

/// A time as Graph answers `originalStart` and the timestamps of a resource.
pub(crate) fn stamp(at: DateTime<Utc>) -> String {
    at.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

const DAYS: [(&str, Weekday); 7] = [
    ("sunday", Weekday::Sun),
    ("monday", Weekday::Mon),
    ("tuesday", Weekday::Tue),
    ("wednesday", Weekday::Wed),
    ("thursday", Weekday::Thu),
    ("friday", Weekday::Fri),
    ("saturday", Weekday::Sat),
];

fn weekday(name: &str) -> Option<Weekday> {
    DAYS.iter()
        .find(|(known, _)| known.eq_ignore_ascii_case(name))
        .map(|(_, day)| *day)
}

/// Why a `recurrence` cannot be expanded.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct InvalidRecurrence(pub(crate) &'static str);

#[derive(Clone, Debug, PartialEq, Eq)]
enum Pattern {
    Daily,
    Weekly {
        days: Vec<Weekday>,
        first: Weekday,
    },
    AbsoluteMonthly {
        day: u32,
    },
    RelativeMonthly {
        days: Vec<Weekday>,
        index: Index,
    },
    AbsoluteYearly {
        day: u32,
        month: u32,
    },
    RelativeYearly {
        days: Vec<Weekday>,
        index: Index,
        month: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Index {
    Nth(usize),
    Last,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Range {
    NoEnd,
    Until(NaiveDate),
    Count(u32),
}

/// Graph's `patternedRecurrence`, read for expansion.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Recurrence {
    pattern: Pattern,
    interval: u32,
    start: NaiveDate,
    range: Range,
}

impl Recurrence {
    pub(crate) fn parse(value: &Value) -> Result<Self, InvalidRecurrence> {
        let pattern = &value["pattern"];
        let range = &value["range"];
        let days = || -> Result<Vec<Weekday>, InvalidRecurrence> {
            let names = pattern["daysOfWeek"]
                .as_array()
                .filter(|names| !names.is_empty())
                .ok_or(InvalidRecurrence("pattern.daysOfWeek"))?;
            names
                .iter()
                .map(|name| name.as_str().and_then(weekday))
                .collect::<Option<Vec<_>>>()
                .ok_or(InvalidRecurrence("pattern.daysOfWeek"))
        };
        let number = |key: &'static str, name: &'static str, max: u64| {
            pattern[key]
                .as_u64()
                .filter(|value| (1..=max).contains(value))
                .and_then(|value| u32::try_from(value).ok())
                .ok_or(InvalidRecurrence(name))
        };
        let index = || match pattern["index"].as_str().unwrap_or("first") {
            "first" => Ok(Index::Nth(0)),
            "second" => Ok(Index::Nth(1)),
            "third" => Ok(Index::Nth(2)),
            "fourth" => Ok(Index::Nth(3)),
            "last" => Ok(Index::Last),
            _ => Err(InvalidRecurrence("pattern.index")),
        };
        let date = |key: &str, name: &'static str| {
            range[key]
                .as_str()
                .and_then(|text| NaiveDate::parse_from_str(text, "%Y-%m-%d").ok())
                .ok_or(InvalidRecurrence(name))
        };

        let kind = pattern["type"]
            .as_str()
            .ok_or(InvalidRecurrence("pattern.type"))?;
        let pattern_read = match kind {
            "daily" => Pattern::Daily,
            "weekly" => Pattern::Weekly {
                days: days()?,
                first: pattern["firstDayOfWeek"]
                    .as_str()
                    .map(|name| weekday(name).ok_or(InvalidRecurrence("pattern.firstDayOfWeek")))
                    .transpose()?
                    .unwrap_or(Weekday::Sun),
            },
            "absoluteMonthly" => Pattern::AbsoluteMonthly {
                day: number("dayOfMonth", "pattern.dayOfMonth", 31)?,
            },
            "relativeMonthly" => Pattern::RelativeMonthly {
                days: days()?,
                index: index()?,
            },
            "absoluteYearly" => Pattern::AbsoluteYearly {
                day: number("dayOfMonth", "pattern.dayOfMonth", 31)?,
                month: number("month", "pattern.month", 12)?,
            },
            "relativeYearly" => Pattern::RelativeYearly {
                days: days()?,
                index: index()?,
                month: number("month", "pattern.month", 12)?,
            },
            _ => return Err(InvalidRecurrence("pattern.type")),
        };
        let range_read = match range["type"].as_str() {
            Some("noEnd") => Range::NoEnd,
            Some("endDate") => Range::Until(date("endDate", "range.endDate")?),
            Some("numbered") => Range::Count(
                range["numberOfOccurrences"]
                    .as_u64()
                    .filter(|count| *count > 0)
                    .and_then(|count| u32::try_from(count).ok())
                    .ok_or(InvalidRecurrence("range.numberOfOccurrences"))?,
            ),
            _ => return Err(InvalidRecurrence("range.type")),
        };
        Ok(Self {
            pattern: pattern_read,
            interval: number("interval", "pattern.interval", 999)?,
            start: date("startDate", "range.startDate")?,
            range: range_read,
        })
    }

    /// The dates of the series from its start up to `until`, oldest first.
    pub(crate) fn dates(&self, until: NaiveDate) -> Vec<NaiveDate> {
        let last = match self.range {
            Range::Until(end) => end.min(until),
            _ => until,
        };
        let limit = match self.range {
            Range::Count(count) => count as usize,
            _ => usize::MAX,
        };
        let mut dates = Vec::new();
        for period in 0..MAX_STEPS {
            let Some(found) = self.period_dates(period) else {
                break;
            };
            let mut past_end = false;
            for date in found {
                if date < self.start {
                    continue;
                }
                if date > last || dates.len() >= limit {
                    past_end = true;
                    break;
                }
                dates.push(date);
            }
            if past_end || dates.len() >= limit {
                break;
            }
        }
        dates
    }

    /// The dates of the `period`th interval after the series' start: a day,
    /// a week, a month or a year, by pattern.
    fn period_dates(&self, period: u32) -> Option<Vec<NaiveDate>> {
        let step = period.checked_mul(self.interval)?;
        match &self.pattern {
            Pattern::Daily => Some(vec![self.start.checked_add_days(Days::new(step.into()))?]),
            Pattern::Weekly { days, first } => {
                let back = self.start.weekday().days_since(*first);
                let week = self
                    .start
                    .checked_sub_days(Days::new(back.into()))?
                    .checked_add_days(Days::new(u64::from(step) * 7))?;
                let mut dates: Vec<NaiveDate> = days
                    .iter()
                    .filter_map(|day| {
                        week.checked_add_days(Days::new(day.days_since(*first).into()))
                    })
                    .collect();
                dates.sort();
                Some(dates)
            }
            Pattern::AbsoluteMonthly { day } => {
                let month = month_start(self.start)?.checked_add_months(Months::new(step))?;
                Some(vec![day_of_month(month, *day)?])
            }
            Pattern::RelativeMonthly { days, index } => {
                let month = month_start(self.start)?.checked_add_months(Months::new(step))?;
                Some(nth_day(month, days, *index).into_iter().collect())
            }
            Pattern::AbsoluteYearly { day, month } => {
                let year = self.start.year().checked_add(i32::try_from(step).ok()?)?;
                let month = NaiveDate::from_ymd_opt(year, *month, 1)?;
                Some(vec![day_of_month(month, *day)?])
            }
            Pattern::RelativeYearly { days, index, month } => {
                let year = self.start.year().checked_add(i32::try_from(step).ok()?)?;
                let month = NaiveDate::from_ymd_opt(year, *month, 1)?;
                Some(nth_day(month, days, *index).into_iter().collect())
            }
        }
    }
}

fn month_start(date: NaiveDate) -> Option<NaiveDate> {
    date.with_day(1)
}

fn month_days(month: NaiveDate) -> impl Iterator<Item = NaiveDate> {
    month
        .iter_days()
        .take_while(move |date| date.month() == month.month())
}

/// A day of the month; a month too short for it gives its last day.
fn day_of_month(month: NaiveDate, day: u32) -> Option<NaiveDate> {
    month.with_day(day).or_else(|| month_days(month).last())
}

/// The `index`th day of the month that is one of `days`.
fn nth_day(month: NaiveDate, days: &[Weekday], index: Index) -> Option<NaiveDate> {
    let mut matching = month_days(month).filter(|date| days.contains(&date.weekday()));
    match index {
        Index::Nth(position) => matching.nth(position),
        Index::Last => matching.last(),
    }
}
