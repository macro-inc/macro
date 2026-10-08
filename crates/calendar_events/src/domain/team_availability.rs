//! Personal availability calculated from individually authorized source copies.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use chrono_tz::{GapInfo, Tz};
use serde::{Deserialize, Serialize};

use super::{
    models::{EventTime, OccurrenceRange},
    team::{TeamAvailabilitySources, TeamCalendarCoverage, TeamSourceOccurrence},
};

/// Maximum merged intervals exposed for one person in a single response.
const BUSY_INTERVALS_MAX: usize = 100;
/// Maximum common free intervals exposed in a single response.
const FREE_INTERVALS_MAX: usize = 100;

/// An exact, half-open interval of UTC instants, without event metadata.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityInterval {
    /// Inclusive start.
    pub start: DateTime<Utc>,
    /// Exclusive end.
    pub end: DateTime<Utc>,
}

/// Whether missing busy blocks can safely be interpreted as free time.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityCoverage {
    /// All selected source data was current and completely evaluated.
    Complete,
    /// Known busy blocks are useful, but gaps cannot establish availability.
    Unknown,
}

/// Why a person's unoccupied intervals cannot establish availability.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityUnknownReason {
    /// The person has not shared their calendar with the requester.
    Hidden,
    /// A source is absent, not fully synced, stale, or otherwise unavailable.
    Unavailable,
    /// The source or result bound prevented complete evaluation or reporting.
    Truncated,
    /// An all-day source did not provide a calendar time zone.
    MissingTimeZone,
    /// An all-day source's time zone could not be interpreted.
    InvalidTimeZone,
    /// A source interval or local-date boundary could not be interpreted.
    InvalidInterval,
    /// Authorized copies of one occurrence disagree about its busy interval.
    ConflictingCopies,
}

/// Busy time and confidence for one explicitly included person.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberAvailability {
    /// Macro identifier of the included person.
    pub user_id: String,
    /// Merged known busy intervals clipped to the requested range.
    pub busy: Vec<AvailabilityInterval>,
    /// Whether the whole requested range was established.
    pub coverage: AvailabilityCoverage,
    /// Reasons gaps in the busy intervals cannot be called free.
    pub unknown_reasons: Vec<AvailabilityUnknownReason>,
}

/// Availability for exactly the members selected by the domain service.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamAvailability {
    /// Inclusive requested start.
    pub start: DateTime<Utc>,
    /// Exclusive requested end.
    pub end: DateTime<Utc>,
    /// Included people, always including the requester.
    pub members: Vec<TeamMemberAvailability>,
    /// Common calendar gaps for every included person, present only with
    /// complete coverage. These are not working-hours or booking guarantees.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_windows: Option<Vec<AvailabilityInterval>>,
    /// Requested identifiers without a current team relationship. No profile
    /// or calendar data about those identifiers is disclosed.
    pub unknown_user_ids: Vec<String>,
    /// True only when all requested people and source intervals were covered.
    pub complete: bool,
    /// A concise explanation that does not overstate incomplete results.
    pub summary: String,
}

#[derive(Default)]
struct MemberIntervals {
    reasons: BTreeSet<AvailabilityUnknownReason>,
    occurrences: BTreeMap<(String, String), BTreeSet<AvailabilityInterval>>,
}

/// Calculate personal busy time after the team service has authorized and
/// selected the sources. No event text, identifiers, or invitees leave this
/// calculation. Unknown coverage suppresses common free windows entirely.
pub fn calculate(range: OccurrenceRange, sources: TeamAvailabilitySources) -> TeamAvailability {
    let mut by_owner: BTreeMap<String, MemberIntervals> = BTreeMap::new();
    for member in &sources.members {
        let intervals = by_owner.entry(member.user_id.clone()).or_default();
        match member.coverage {
            TeamCalendarCoverage::Ready => {}
            TeamCalendarCoverage::Unavailable => {
                intervals
                    .reasons
                    .insert(AvailabilityUnknownReason::Unavailable);
            }
            TeamCalendarCoverage::Hidden => {
                intervals.reasons.insert(AvailabilityUnknownReason::Hidden);
            }
        }
        if !sources.complete {
            intervals
                .reasons
                .insert(AvailabilityUnknownReason::Truncated);
        }
        if range.ends_at <= range.starts_at {
            intervals
                .reasons
                .insert(AvailabilityUnknownReason::InvalidInterval);
        }
    }

    for source in &sources.sources {
        let Some(member) = by_owner.get_mut(&source.shared_by) else {
            continue;
        };
        if member.reasons.contains(&AvailabilityUnknownReason::Hidden)
            || !source.is_personally_busy()
        {
            continue;
        }
        let time = source.time();
        let interval = match interval(time, source.calendar_time_zone.as_deref()) {
            Ok(interval) => interval,
            Err(reason) => {
                member.reasons.insert(reason);
                continue;
            }
        };
        if interval.start >= range.ends_at
            || (interval.end <= range.starts_at
                && !(interval.start == interval.end && interval.start == range.starts_at))
        {
            continue;
        }
        member
            .occurrences
            .entry((source.event.ical_uid.clone(), original_identity(source)))
            .or_default()
            .insert(interval);
    }

    let mut all_busy = Vec::new();
    let mut members = Vec::with_capacity(by_owner.len());
    for (user_id, mut intervals) in by_owner {
        let mut busy = Vec::new();
        for copies in intervals.occurrences.into_values() {
            if copies.len() > 1 {
                intervals
                    .reasons
                    .insert(AvailabilityUnknownReason::ConflictingCopies);
            }
            busy.extend(copies);
        }
        let mut busy = merge_intervals(busy, &range);
        all_busy.extend(busy.iter().cloned());
        if busy.len() > BUSY_INTERVALS_MAX {
            busy.truncate(BUSY_INTERVALS_MAX);
            intervals
                .reasons
                .insert(AvailabilityUnknownReason::Truncated);
        }
        members.push(TeamMemberAvailability {
            user_id,
            busy,
            coverage: if intervals.reasons.is_empty() {
                AvailabilityCoverage::Complete
            } else {
                AvailabilityCoverage::Unknown
            },
            unknown_reasons: intervals.reasons.into_iter().collect(),
        });
    }

    let mut unknown_user_ids = sources.unknown_user_ids;
    unknown_user_ids.sort();
    unknown_user_ids.dedup();
    let mut complete = sources.complete
        && unknown_user_ids.is_empty()
        && !members.is_empty()
        && range.ends_at > range.starts_at
        && members
            .iter()
            .all(|member| member.coverage == AvailabilityCoverage::Complete);
    let mut free_windows = complete.then(|| gaps(merge_intervals(all_busy, &range), &range));
    if free_windows
        .as_ref()
        .is_some_and(|windows| windows.len() > FREE_INTERVALS_MAX)
    {
        free_windows = None;
        complete = false;
        for member in &mut members {
            member.coverage = AvailabilityCoverage::Unknown;
            member
                .unknown_reasons
                .push(AvailabilityUnknownReason::Truncated);
        }
    }
    let summary = if complete {
        format!(
            "Checked {} people, including you. Common free windows cover only the requested calendar range; working hours are not applied.",
            members.len()
        )
    } else {
        format!(
            "Checked {} people, including you. Coverage is incomplete; known busy intervals do not establish when everyone is free.",
            members.len()
        )
    };
    TeamAvailability {
        start: range.starts_at,
        end: range.ends_at,
        members,
        free_windows,
        unknown_user_ids,
        complete,
        summary,
    }
}

fn original_identity(source: &TeamSourceOccurrence) -> String {
    if let Some(exception) = source.exception() {
        return exception.original_time.occurrence_key();
    }
    if source.occurrence.recurrence_id.is_none() && source.event.recurrence_lines.is_empty() {
        return String::new();
    }
    // The materialized occurrence key identifies the original occurrence;
    // the current start may change when a single instance is moved.
    source.occurrence.occurrence_key.clone()
}

fn interval(
    time: &EventTime,
    calendar_zone: Option<&str>,
) -> Result<AvailabilityInterval, AvailabilityUnknownReason> {
    if !time.is_valid() {
        return Err(AvailabilityUnknownReason::InvalidInterval);
    }
    let (start, end) = match time {
        EventTime::Timed {
            starts_at, ends_at, ..
        } => (*starts_at, *ends_at),
        EventTime::AllDay {
            start_date,
            end_date,
        } => {
            let zone = calendar_zone.ok_or(AvailabilityUnknownReason::MissingTimeZone)?;
            let zone: Tz = zone
                .parse()
                .map_err(|_| AvailabilityUnknownReason::InvalidTimeZone)?;
            (
                day_boundary(*start_date, zone)?,
                day_boundary(*end_date, zone)?,
            )
        }
    };
    if end < start || (end == start && matches!(time, EventTime::AllDay { .. })) {
        return Err(AvailabilityUnknownReason::InvalidInterval);
    }
    Ok(AvailabilityInterval { start, end })
}

fn day_boundary(date: NaiveDate, zone: Tz) -> Result<DateTime<Utc>, AvailabilityUnknownReason> {
    let midnight = date.and_time(chrono::NaiveTime::MIN);
    // Civil dates begin at the earliest midnight during a repeated hour, or
    // at the first valid instant after a gap when midnight was skipped.
    zone.from_local_datetime(&midnight)
        .earliest()
        .or_else(|| GapInfo::new(&midnight, &zone).and_then(|gap| gap.end))
        .map(|instant| instant.with_timezone(&Utc))
        .ok_or(AvailabilityUnknownReason::InvalidInterval)
}

fn merge_intervals(
    intervals: Vec<AvailabilityInterval>,
    range: &OccurrenceRange,
) -> Vec<AvailabilityInterval> {
    let mut intervals: Vec<_> = intervals
        .into_iter()
        .filter_map(|interval| {
            let start = interval.start.max(range.starts_at);
            let end = interval.end.min(range.ends_at);
            (start < end).then_some(AvailabilityInterval { start, end })
        })
        .collect();
    intervals.sort();
    let mut merged: Vec<AvailabilityInterval> = Vec::new();
    for interval in intervals {
        if let Some(previous) = merged.last_mut()
            && interval.start <= previous.end
        {
            previous.end = previous.end.max(interval.end);
        } else {
            merged.push(interval);
        }
    }
    merged
}

fn gaps(busy: Vec<AvailabilityInterval>, range: &OccurrenceRange) -> Vec<AvailabilityInterval> {
    let mut free = Vec::new();
    let mut cursor = range.starts_at;
    for interval in busy {
        if cursor < interval.start {
            free.push(AvailabilityInterval {
                start: cursor,
                end: interval.start,
            });
        }
        cursor = cursor.max(interval.end);
    }
    if cursor < range.ends_at {
        free.push(AvailabilityInterval {
            start: cursor,
            end: range.ends_at,
        });
    }
    free
}

#[cfg(test)]
mod test;
