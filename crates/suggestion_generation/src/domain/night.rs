//! When a person's nightly generation is due: once a night, at a time of
//! their own inside [`NIGHT`] in their zone, so people in one zone don't all
//! start at once and the scheduler reads only who is due.

use chrono::{DateTime, NaiveDate, NaiveTime, TimeDelta, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Local hours nightly generations run in: start inclusive, end exclusive.
pub const NIGHT: (u8, u8) = (2, 5);

/// Whether `at` is inside the night in `timezone`.
pub fn in_night(timezone: Tz, at: DateTime<Utc>) -> bool {
    let hour = at.with_timezone(&timezone).hour();
    (u32::from(NIGHT.0)..u32::from(NIGHT.1)).contains(&hour)
}

/// When a person just seen at `now` is next due: their time tonight if it
/// is still ahead, now if tonight's time passed but the night hasn't, else
/// their time the next night.
pub fn upcoming(user: &MacroUserIdStr<'_>, timezone: Tz, now: DateTime<Utc>) -> DateTime<Utc> {
    let local = now.with_timezone(&timezone);
    let today = local.date_naive();
    if local.hour() < u32::from(NIGHT.0) {
        return slot(user, timezone, today);
    }
    if local.hour() < u32::from(NIGHT.1) {
        return slot(user, timezone, today).max(now);
    }
    slot(user, timezone, next_day(today))
}

/// When a person whose run started (or was passed over) at `now` is next
/// due: their time the next night that hasn't begun yet.
pub fn following(user: &MacroUserIdStr<'_>, timezone: Tz, now: DateTime<Utc>) -> DateTime<Utc> {
    let local = now.with_timezone(&timezone);
    let today = local.date_naive();
    if local.hour() < u32::from(NIGHT.0) {
        slot(user, timezone, today)
    } else {
        slot(user, timezone, next_day(today))
    }
}

fn next_day(day: NaiveDate) -> NaiveDate {
    day.succ_opt().unwrap_or(day)
}

/// The person's time on the night starting on `day`: the night's start plus
/// a fixed offset of theirs, leaving the last hour for runs that wait.
fn slot(user: &MacroUserIdStr<'_>, timezone: Tz, day: NaiveDate) -> DateTime<Utc> {
    let spread = (u32::from(NIGHT.1) - u32::from(NIGHT.0)).saturating_sub(1) * 60;
    let minute = offset(user.as_ref()) % spread.max(1);
    let start = NaiveTime::from_hms_opt(u32::from(NIGHT.0), 0, 0).unwrap_or_default();
    let local = day.and_time(start) + TimeDelta::minutes(i64::from(minute));
    // A clock change can skip or repeat the local time; take the earliest
    // instant, or an hour later when it was skipped.
    timezone
        .from_local_datetime(&local)
        .earliest()
        .or_else(|| {
            timezone
                .from_local_datetime(&(local + TimeDelta::hours(1)))
                .earliest()
        })
        .map_or_else(
            || Utc.from_utc_datetime(&local),
            |at| at.with_timezone(&Utc),
        )
}

/// A stable spread of people over the night (FNV-1a of their id): the same
/// every night and on every process.
fn offset(id: &str) -> u32 {
    id.bytes().fold(0x811c_9dc5_u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
    })
}
