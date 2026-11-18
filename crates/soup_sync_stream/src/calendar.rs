//! Calendar windows: the months a calendar lane covers, nearest first, cut
//! down to what the client's cache has not fetched yet.
//!
//! Months and dates are the client's local ones, in the time zone its request
//! names, as its calendar reads them. Timed spans are UTC milliseconds, all-day
//! spans local dates in days since 1970-01-01, both end-exclusive, as the
//! cache records coverage (`cache_core::calendar::CalendarSpan`).

#[cfg(test)]
mod test;

use chrono::{
    DateTime, Datelike as _, Days, LocalResult, NaiveDate, NaiveTime, TimeDelta, TimeZone, Utc,
};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;

/// Days back the server materializes occurrences for.
const HISTORY_DAYS: u64 = 364;
/// Days ahead the server materializes occurrences for.
const FUTURE_DAYS: u64 = 729;

/// Units of a [`CalendarSpan`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpanKind {
    /// UTC instants in milliseconds since the Unix epoch.
    Timed,
    /// Local dates in days since 1970-01-01.
    AllDay,
}

/// A half-open span the client's cache holds every occurrence of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CalendarSpan {
    /// Unit of `start` and `end`.
    pub kind: SpanKind,
    /// Inclusive start.
    pub start: i64,
    /// Exclusive end.
    pub end: i64,
}

/// One calendar lane's fetch: its `CalendarRangeInput` fields and the spans
/// it proves covered once every page arrived.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CalendarWindow {
    /// `start`, `end` (ISO instants), `startDate`, `endDate` (local dates).
    pub(crate) input: Map<String, Value>,
    pub(crate) coverage: [CalendarSpan; 2],
}

/// Windows for `months` each way of this month, nearest month first, without
/// what `coverage` already holds, at most `budget` of them. The months are
/// clamped to the range the server materializes.
pub(crate) fn calendar_windows(
    zone: Tz,
    coverage: &[CalendarSpan],
    now: DateTime<Utc>,
    months: u32,
    budget: usize,
) -> Vec<CalendarWindow> {
    let mut windows = Vec::new();
    let mut seen = HashSet::new();
    for (start, end) in backfill_months(zone, now, months) {
        if windows.len() >= budget {
            break;
        }
        let start_day = epoch_day(local_date(zone, start));
        let end_day = epoch_day(local_date(zone, end));
        let requested = [
            CalendarSpan {
                kind: SpanKind::Timed,
                start: start.timestamp_millis(),
                end: end.timestamp_millis(),
            },
            CalendarSpan {
                kind: SpanKind::AllDay,
                start: start_day,
                end: end_day,
            },
        ];
        let gaps = requested
            .into_iter()
            .flat_map(|span| coverage_gaps(coverage, span))
            .collect::<Vec<_>>();
        for window in gap_windows(zone, &gaps) {
            if windows.len() >= budget {
                break;
            }
            if seen.insert(window.coverage) {
                windows.push(window);
            }
        }
    }
    windows
}

/// This month, then alternating forward and back to `months` each way, each
/// from its local first midnight to the next month's, clamped to the
/// materialized range.
fn backfill_months(
    zone: Tz,
    now: DateTime<Utc>,
    months: u32,
) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
    let today = local_date(zone, now);
    let supported_start = today
        .checked_sub_days(Days::new(HISTORY_DAYS))
        .map(|date| local_midnight(zone, date));
    let supported_end = today
        .checked_add_days(Days::new(FUTURE_DAYS))
        .map(|date| local_midnight(zone, date));
    let (Some(supported_start), Some(supported_end)) = (supported_start, supported_end) else {
        return Vec::new();
    };
    let mut offsets = vec![0_i32];
    for offset in 1..=i32::try_from(months).unwrap_or(i32::MAX) {
        offsets.extend([offset, -offset]);
    }
    offsets
        .into_iter()
        .filter_map(|offset| {
            let start = month_start(zone, today, offset)?.max(supported_start);
            let end = month_start(zone, today, offset + 1)?.min(supported_end);
            (start < end).then_some((start, end))
        })
        .collect()
}

/// Local midnight of the first day of the month `offset` months from `today`'s.
fn month_start(zone: Tz, today: NaiveDate, offset: i32) -> Option<DateTime<Utc>> {
    let months = i64::from(today.year()) * 12 + i64::from(today.month0()) + i64::from(offset);
    let year = i32::try_from(months.div_euclid(12)).ok()?;
    let month = u32::try_from(months.rem_euclid(12)).ok()? + 1;
    NaiveDate::from_ymd_opt(year, month, 1).map(|date| local_midnight(zone, date))
}

/// Fetches for uncovered spans. A timed gap fetches its local dates too; an
/// all-day gap that no timed fetch already spans fetches its own local
/// midnights. Each window proves coverage of everything it fetched.
fn gap_windows(zone: Tz, gaps: &[CalendarSpan]) -> Vec<CalendarWindow> {
    let mut windows = Vec::new();
    for gap in gaps.iter().filter(|gap| gap.kind == SpanKind::Timed) {
        let (Some(start), Some(end)) = (instant(gap.start), instant(gap.end)) else {
            continue;
        };
        let start_date = local_date(zone, start);
        let end_date = local_date_ceil(zone, end);
        windows.push(CalendarWindow {
            input: window_input(start, end, start_date, end_date),
            coverage: [
                *gap,
                CalendarSpan {
                    kind: SpanKind::AllDay,
                    start: epoch_day(start_date),
                    end: epoch_day(end_date),
                },
            ],
        });
    }
    let fetched_days = windows
        .iter()
        .map(|window| window.coverage[1])
        .collect::<Vec<_>>();
    for gap in gaps.iter().filter(|gap| gap.kind == SpanKind::AllDay) {
        if fetched_days
            .iter()
            .any(|days| days.start <= gap.start && days.end >= gap.end)
        {
            continue;
        }
        let (Some(start_date), Some(end_date)) =
            (epoch_day_date(gap.start), epoch_day_date(gap.end))
        else {
            continue;
        };
        let start = local_midnight(zone, start_date);
        let end = local_midnight(zone, end_date);
        windows.push(CalendarWindow {
            input: window_input(start, end, start_date, end_date),
            coverage: [
                CalendarSpan {
                    kind: SpanKind::Timed,
                    start: start.timestamp_millis(),
                    end: end.timestamp_millis(),
                },
                *gap,
            ],
        });
    }
    windows
}

fn window_input(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Map<String, Value> {
    Map::from_iter([
        ("start".to_owned(), Value::String(iso_instant(start))),
        ("end".to_owned(), Value::String(iso_instant(end))),
        (
            "startDate".to_owned(),
            Value::String(start_date.to_string()),
        ),
        ("endDate".to_owned(), Value::String(end_date.to_string())),
    ])
}

/// The parts of `request` no span of the same kind in `coverage` covers.
/// Mirrors `cache_core::calendar::coverage::coverage_gaps`.
fn coverage_gaps(coverage: &[CalendarSpan], request: CalendarSpan) -> Vec<CalendarSpan> {
    if request.end <= request.start {
        return Vec::new();
    }
    let mut covered = coverage
        .iter()
        .filter(|span| span.kind == request.kind && span.end > span.start)
        .copied()
        .collect::<Vec<_>>();
    covered.sort();
    let mut gaps = Vec::new();
    let mut cursor = request.start;
    for span in covered {
        if span.end <= cursor {
            continue;
        }
        if span.start >= request.end {
            break;
        }
        if span.start > cursor {
            gaps.push(CalendarSpan {
                kind: request.kind,
                start: cursor,
                end: span.start,
            });
        }
        cursor = span.end;
        if cursor >= request.end {
            break;
        }
    }
    if cursor < request.end {
        gaps.push(CalendarSpan {
            kind: request.kind,
            start: cursor,
            end: request.end,
        });
    }
    gaps
}

/// The first instant of `date` in `zone`. A midnight a clock change skips
/// becomes the first local time after it, and a repeated one its earlier
/// instant, as JavaScript's local `Date` constructor resolves them.
fn local_midnight(zone: Tz, date: NaiveDate) -> DateTime<Utc> {
    let midnight = date.and_time(NaiveTime::MIN);
    let mut local = midnight;
    // Clock changes skip at most a few hours.
    for _ in 0..24 {
        match zone.from_local_datetime(&local) {
            LocalResult::Single(time) | LocalResult::Ambiguous(time, _) => {
                return time.with_timezone(&Utc);
            }
            LocalResult::None => local += TimeDelta::minutes(30),
        }
    }
    midnight.and_utc()
}

/// The local date of an instant.
fn local_date(zone: Tz, instant: DateTime<Utc>) -> NaiveDate {
    instant.with_timezone(&zone).date_naive()
}

/// The first local date at or after an instant.
fn local_date_ceil(zone: Tz, instant: DateTime<Utc>) -> NaiveDate {
    let floor = local_date(zone, instant);
    if local_midnight(zone, floor) == instant {
        floor
    } else {
        floor.succ_opt().unwrap_or(floor)
    }
}

/// `NaiveDate::num_days_from_ce` of 1970-01-01.
const UNIX_EPOCH_DAYS_FROM_CE: i64 = 719_163;

fn epoch_day(date: NaiveDate) -> i64 {
    i64::from(date.num_days_from_ce()) - UNIX_EPOCH_DAYS_FROM_CE
}

fn epoch_day_date(day: i64) -> Option<NaiveDate> {
    NaiveDate::from_num_days_from_ce_opt(i32::try_from(day + UNIX_EPOCH_DAYS_FROM_CE).ok()?)
}

fn instant(ms: i64) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp_millis(ms)
}

/// An instant as JavaScript's `toISOString` writes it: UTC, milliseconds.
pub(crate) fn iso_instant(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
