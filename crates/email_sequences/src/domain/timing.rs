//! When each step comes due: one rule for starting, advancing and resuming.

#[cfg(test)]
mod test;

use super::models::SendClock;
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Timelike, Utc};

/// The earliest a step may come due, so its schedule is always in the future
/// by the time the sweep creates it.
pub const LEAD_TIME: Duration = Duration::minutes(2);

/// The send clock an enrollment started at `start` in `timezone` keeps.
pub fn send_clock(start: DateTime<Utc>, timezone: chrono_tz::Tz) -> SendClock {
    SendClock {
        timezone,
        send_time: start
            .with_timezone(&timezone)
            .time()
            .with_nanosecond(0)
            .unwrap_or_default(),
    }
}

/// When an enrollment's first step comes due.
pub fn first_due(start: DateTime<Utc>, now: DateTime<Utc>) -> DateTime<Utc> {
    start.max(now + LEAD_TIME)
}

/// How far past its send time a step's slot can fall and still count as sent
/// on the day it was due: the lead time plus spacing behind a batch.
const SLIP: Duration = Duration::hours(1);

/// When the step after one scheduled at `previous` comes due: that step's
/// local date plus `delay_days`, at the enrollment's send time. A step due
/// late in the evening whose slot slipped past midnight keeps its day. A step
/// that would be due before `now + LEAD_TIME` is due then instead.
pub fn next_due(
    previous: DateTime<Utc>,
    delay_days: u16,
    clock: SendClock,
    now: DateTime<Utc>,
) -> DateTime<Utc> {
    let mut day = previous.with_timezone(&clock.timezone).date_naive();
    if let Some(day_before) = day.pred_opt() {
        let due_day_before = local_instant(clock.timezone, day_before.and_time(clock.send_time));
        if local_instant(clock.timezone, day.and_time(clock.send_time)) > previous
            && previous - due_day_before <= SLIP
        {
            day = day_before;
        }
    }
    let date = day + Duration::days(i64::from(delay_days));
    local_instant(clock.timezone, date.and_time(clock.send_time)).max(now + LEAD_TIME)
}

/// The instant a wall-clock time names. A time skipped by a daylight-saving
/// change moves forward to the first one that exists; a repeated one takes the
/// earlier.
fn local_instant(timezone: chrono_tz::Tz, local: NaiveDateTime) -> DateTime<Utc> {
    // Offset changes are at most a few hours; a day bounds the search.
    const MAX_GAP_MINUTES: i64 = 24 * 60;
    for minutes in 0..=MAX_GAP_MINUTES {
        match timezone.from_local_datetime(&(local + Duration::minutes(minutes))) {
            LocalResult::Single(at) => return at.with_timezone(&Utc),
            LocalResult::Ambiguous(earlier, _) => return earlier.with_timezone(&Utc),
            LocalResult::None => {}
        }
    }
    local.and_utc()
}
