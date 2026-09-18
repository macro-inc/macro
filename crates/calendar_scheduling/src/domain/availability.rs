//! Deterministic, timezone-aware slot generation and configuration validation.
use super::models::*;
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Offset, TimeZone, Utc};
use std::collections::HashSet;

/// Validate all persisted scheduling rules before accepting configuration.
pub fn validate_profile(profile: &Profile, team: bool) -> Result<(), Error> {
    if profile.name.trim().is_empty()
        || profile.name.len() > 200
        || profile.description.len() > 4000
        || profile.schedules.len() > 30
        || profile.event_types.len() > 100
    {
        return invalid("Profile fields exceed their limits");
    }
    let mut schedule_ids = HashSet::new();
    for schedule in &profile.schedules {
        if !schedule_ids.insert(schedule.id)
            || schedule.name.trim().is_empty()
            || schedule.name.len() > 100
            || schedule.weekly.len() != 7
            || schedule.overrides.len() > 366
        {
            return invalid("Invalid availability schedule");
        }
        let mut days = HashSet::new();
        for day in &schedule.weekly {
            if day.day > 6 || !days.insert(day.day) {
                return invalid("Each weekday must appear exactly once");
            }
            validate_windows(&day.windows)?;
        }
        let mut dates = HashSet::new();
        for date in &schedule.overrides {
            if !dates.insert(date.date) {
                return invalid("Only one override is allowed per date");
            }
            validate_windows(&date.windows)?;
        }
    }
    if profile
        .default_schedule_id
        .is_some_and(|id| !schedule_ids.contains(&id))
    {
        return invalid("Choose an existing default availability schedule");
    }
    let mut ids = HashSet::new();
    let mut slugs = HashSet::new();
    for event in &profile.event_types {
        if !ids.insert(event.id)
            || !slugs.insert(&event.slug)
            || event.slug.is_empty()
            || event.slug.len() > 80
            || event.slug.starts_with('-')
            || event.slug.ends_with('-')
            || event.slug.contains("--")
            || !event
                .slug
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return invalid("Booking links must have unique lowercase slugs");
        }
        if event.title.trim().is_empty()
            || event.title.len() > 200
            || event.description.len() > 4000
            || event.location.len() > 2000
            || !(5..=480).contains(&event.duration_minutes)
            || !(5..=480).contains(&event.interval_minutes)
            || !(1..=365).contains(&event.horizon_days)
            || event.before_minutes > 10080
            || event.after_minutes > 10080
            || event.notice_minutes > 10080
            || event.daily_limit.is_some_and(|n| !(1..=100).contains(&n))
        {
            return invalid("Invalid event duration, booking limits, or text fields");
        }
        if !schedule_ids.contains(&event.schedule_id)
            || event.hosts.is_empty()
            || event.hosts.len() > 30
            || event.hosts.iter().collect::<HashSet<_>>().len() != event.hosts.len()
        {
            return invalid("Choose an availability schedule and distinct hosts");
        }
        if (!team && (event.mode != SchedulingMode::Individual || event.hosts.len() != 1))
            || (team && event.mode == SchedulingMode::Individual)
        {
            return invalid("Scheduling type does not match the profile");
        }
        if event.questions.len() > 20
            || event
                .questions
                .iter()
                .any(|q| q.label.trim().is_empty() || q.label.len() > 500)
            || event
                .questions
                .iter()
                .map(|q| q.id)
                .collect::<HashSet<_>>()
                .len()
                != event.questions.len()
        {
            return invalid("Invalid booking questions");
        }
    }
    Ok(())
}
fn invalid<T>(message: &str) -> Result<T, Error> {
    Err(Error::Invalid(message.into()))
}
fn parse_time(value: &str) -> Result<NaiveTime, Error> {
    if value.len() != 5 {
        return invalid("Times must use HH:MM");
    }
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|_| Error::Invalid("Invalid time".into()))
}
fn validate_windows(windows: &[TimeWindow]) -> Result<(), Error> {
    if windows.len() > 8 {
        return invalid("At most eight time ranges are allowed per day");
    }
    let mut intervals = windows
        .iter()
        .map(|w| Ok((parse_time(&w.start)?, parse_time(&w.end)?)))
        .collect::<Result<Vec<_>, Error>>()?;
    intervals.sort();
    for (index, (start, end)) in intervals.iter().enumerate() {
        if start >= end || (index > 0 && intervals[index - 1].1 > *start) {
            return invalid("Time ranges must be positive and cannot overlap");
        }
    }
    Ok(())
}

fn windows_for_date(schedule: &Schedule, date: NaiveDate) -> Option<&[TimeWindow]> {
    schedule
        .overrides
        .iter()
        .find(|o| o.date == date)
        .map(|o| o.windows.as_slice())
        .or_else(|| {
            schedule
                .weekly
                .iter()
                .find(|d| u32::from(d.day) == date.weekday().num_days_from_sunday())
                .map(|d| d.windows.as_slice())
        })
}

/// Check a team slot against a host's own hours and date overrides in their local zone.
pub fn schedule_contains(
    schedule: &Schedule,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
) -> Result<bool, Error> {
    let start = starts_at.with_timezone(&schedule.time_zone);
    let end = ends_at.with_timezone(&schedule.time_zone);
    if start.date_naive() != end.date_naive() {
        return Ok(false);
    }
    for window in windows_for_date(schedule, start.date_naive()).unwrap_or_default() {
        let window_start = parse_time(&window.start)?;
        let window_end = parse_time(&window.end)?;
        if start.time() < window_start || end.time() > window_end {
            continue;
        }
        if start.offset().fix() == end.offset().fix() {
            return Ok(true);
        }
        // A repeated DST hour can leave a window between two apparently valid endpoints.
        // Scheduling starts and durations have minute precision, so inspect the transition.
        let mut instant = starts_at;
        let mut contained = true;
        while instant < ends_at {
            let local = instant.with_timezone(&schedule.time_zone).time();
            if local < window_start || local >= window_end {
                contained = false;
                break;
            }
            instant += Duration::minutes(1);
        }
        if contained {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Offer starts for one date; ambiguous/nonexistent DST wall-clock starts are skipped.
pub fn slots_for_date(
    event: &EventType,
    schedule: &Schedule,
    date: NaiveDate,
    now: DateTime<Utc>,
    busy: &[BusyRange],
) -> Result<Vec<Slot>, Error> {
    if !event.enabled {
        return Ok(vec![]);
    }
    let windows = windows_for_date(schedule, date);
    let Some(windows) = windows else {
        return Ok(vec![]);
    };
    let mut slots = vec![];
    for window in windows {
        let mut local = date.and_time(parse_time(&window.start)?);
        let local_end = date.and_time(parse_time(&window.end)?);
        while local < local_end {
            let instant = schedule.time_zone.from_local_datetime(&local).single();
            local += Duration::minutes(i64::from(event.interval_minutes));
            let Some(start) = instant.map(|t| t.with_timezone(&Utc)) else {
                continue;
            };
            let end = start + Duration::minutes(i64::from(event.duration_minutes));
            if end.with_timezone(&schedule.time_zone).naive_local() > local_end
                || start < now + Duration::minutes(i64::from(event.notice_minutes))
                || start > now + Duration::days(i64::from(event.horizon_days))
            {
                continue;
            }
            let occupied_start = start - Duration::minutes(i64::from(event.before_minutes));
            let occupied_end = end + Duration::minutes(i64::from(event.after_minutes));
            let hosts: Vec<_> = event
                .hosts
                .iter()
                .filter(|host| {
                    !busy.iter().any(|b| {
                        &b.host == *host && b.start < occupied_end && b.end > occupied_start
                    })
                })
                .cloned()
                .collect();
            let available = match event.mode {
                SchedulingMode::Individual | SchedulingMode::Collective => {
                    hosts.len() == event.hosts.len()
                }
                SchedulingMode::RoundRobin => !hosts.is_empty(),
            };
            if available {
                slots.push(Slot {
                    starts_at: start,
                    ends_at: end,
                    hosts,
                });
            }
        }
    }
    slots.sort_by_key(|s| s.starts_at);
    Ok(slots)
}

#[cfg(test)]
mod test;
