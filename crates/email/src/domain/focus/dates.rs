//! When the days a thread's mail names take effect for its owner.

use chrono::{DateTime, Days, NaiveDate, NaiveTime, TimeZone as _, Utc};
use chrono_tz::Tz;

use super::{
    calendar::begun_everywhere,
    models::{FocusAnswers, FocusDates, FocusVerdict, ThreadDates},
    rule::owner_has_something_to_do,
};

#[cfg(test)]
mod test;

/// Latest local hour a clock change at midnight can push a day's start to.
const LATEST_DAY_START_HOUR: u32 = 2;
/// How many days after a meeting's day mail in its thread is still taken to be
/// about the meeting; later mail is about something else.
const MEETING_MAIL_DAYS: i64 = 14;

/// When `day` begins for an owner in `time_zone`: its first local hour that
/// exists, since a clock change can skip midnight. With no zone, once it has
/// begun everywhere, so it never comes early for the owner.
fn start_of_day(day: NaiveDate, time_zone: Option<Tz>) -> DateTime<Utc> {
    time_zone
        .and_then(|zone| {
            (0..=LATEST_DAY_START_HOUR).find_map(|hour| {
                let local = day.and_time(NaiveTime::from_hms_opt(hour, 0, 0)?);
                zone.from_local_datetime(&local).earliest()
            })
        })
        .map(|at| at.to_utc())
        .unwrap_or_else(|| begun_everywhere(day))
}

/// A thread's days and when they take effect, classified at its latest message,
/// `latest_at`, as `verdict` from `answers`. The meeting's day lets the thread go
/// once it is over only when nothing else keeps it: a calendar change's own hold
/// decides for it, and a deadline after that day outlasts it (one on the day is
/// the meeting's own preparation). Mail written once the meeting was over, notes
/// or thanks, lets the thread go at once, unless the owner still has something to
/// do in it (a reply, a decision only they can make, or an answer of their own
/// still awaited): then the thread is judged on its own. Mail written more than
/// `MEETING_MAIL_DAYS` after the meeting's day drops it: `last_written_on` is the
/// latest day the thread's messages were written on, by the calendar the read
/// counts by, messages the read never saw (with no text of their own) included.
pub(super) fn focus_dates(
    dates: ThreadDates,
    time_zone: Option<Tz>,
    verdict: &FocusVerdict,
    answers: &FocusAnswers,
    latest_at: DateTime<Utc>,
    last_written_on: Option<NaiveDate>,
) -> FocusDates {
    let something_to_do = owner_has_something_to_do(answers, verdict);
    let event_over_at = dates
        .event_on
        .filter(|_| verdict.calendar_hold_until.is_none())
        .filter(|event_on| dates.due_on.is_none_or(|due_on| due_on <= *event_on))
        .filter(|event_on| {
            last_written_on
                .is_none_or(|written_on| (written_on - *event_on).num_days() <= MEETING_MAIL_DAYS)
        })
        .and_then(|event_on| event_on.checked_add_days(Days::new(1)))
        .map(|day_after| start_of_day(day_after, time_zone))
        .filter(|over_at| *over_at > latest_at || !something_to_do);
    FocusDates {
        due_on: dates.due_on,
        due_at: dates.due_on.map(|due_on| start_of_day(due_on, time_zone)),
        event_over_at,
    }
}
