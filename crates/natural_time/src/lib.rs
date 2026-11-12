//! Reads English date and time phrases, such as "next friday at 3",
//! "end of month", "in 2 hours" or "nov 5-7", into calendar dates, with no
//! model or network.
//!
//! [`read`] takes the phrase, the reader's local wall-clock time, which part
//! of a longer phrase to [`Pick`], and an optional time for dates written
//! without one. Callers turn the result into an instant in their own time
//! zone, so the crate carries no time zone database and builds for the
//! browser.
//!
//! # How phrases are read
//!
//! - Weeks run Monday to Sunday. A bare or `this` weekday is its next
//!   occurrence, today included. `next friday` is the Friday of next week;
//!   `last friday` is the most recent Friday before today.
//! - A week, weekend, month or year is a range. [`Pick::End`] takes its end:
//!   a week's Friday (its Sunday once that Friday has passed), a weekend's
//!   Sunday, a month's or year's last day. [`Pick::Start`] and [`Pick::Span`]
//!   take its start, or today when the range has already begun.
//! - A month and day without a year is this year's, unless it passed more
//!   than a month ago; then it is next year's. `the 12th` is the next 12th.
//! - Numeric dates are month first: `11/12` is November 12.
//! - A time without am/pm guesses business hours: 1–7 is pm, 8–11 am and 12
//!   noon. In a range, the side that says am or pm settles the other, so
//!   `2-3pm` is 2pm to 3pm. [`read_other_meridiem`] reads a guessed hour in
//!   the other half of the day, for callers that offer both.
//! - Parts of the day: morning 9am, noon and lunch 12pm, afternoon 1pm, end
//!   of day 5pm, evening 6pm, night and tonight 8pm. Midnight ends its day.
//! - A time alone, or on a bare weekday, that has already passed today moves
//!   to its next occurrence.
//! - A date with no time is at the caller's default time when one is given,
//!   and otherwise a whole day.
//! - A range end or a length (`for 45 min`) is kept by [`Pick::Span`];
//!   [`Pick::End`] takes the end and [`Pick::Start`] the start. `in 2 hours`
//!   is elapsed time from now, so `in 2 hours for 30 min` ends 150 minutes
//!   from now.
//! - Day and month names take common abbreviations (`tues`, `thurs`, `sept`)
//!   and typos: one in a name of six or seven letters (`fridya`), two from
//!   eight letters up (`thrsdy`). The closest name wins; a tie isn't read.
//! - Filler such as `by`, `due`, `on`, `at` and `the` is ignored.
//! - Repeating phrases (`every friday`) are not read yet.
#![deny(missing_docs)]

use chrono::{NaiveDate, NaiveDateTime, NaiveTime, TimeDelta};

mod grammar;
mod phrase;
mod resolve;
mod words;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

#[cfg(test)]
mod test;

/// Which part to read of a phrase that covers more than a moment: a week, a
/// month, or a range such as "2-3pm".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pick {
    /// The first day or time, as when a reminder shows up. A week or month
    /// that has already begun starts today.
    Start,
    /// The last day or time, as a due date. A week ends on its Friday, or on
    /// its Sunday once that Friday has passed; a weekend on its Sunday; a
    /// month or year on its last day.
    End,
    /// The start, and the end when the phrase writes one: a range such as
    /// "nov 12-14" or "2-3pm", or a length such as "for 45 min", as for a
    /// calendar event. A week or month alone gives only its start.
    Span,
}

/// A point a phrase names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Moment {
    /// A whole day: a date with no time, or an all-day event.
    Day(NaiveDate),
    /// A local wall-clock time.
    At(NaiveDateTime),
    /// Elapsed time from now, as in "in 2 hours"; add it to the current
    /// instant rather than to the wall clock.
    After(TimeDelta),
}

/// Parts of a reading that were guessed rather than written.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(target_arch = "wasm32", derive(serde::Serialize))]
pub struct Assumed {
    /// am or pm was guessed from business hours.
    pub meridiem: bool,
    /// The year wasn't written, and the date is past or not in this year.
    pub year: bool,
    /// The time is the caller's default, because the phrase wrote none.
    pub time: bool,
}

/// Where a phrase lands on the calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reading {
    /// The date or time picked.
    pub start: Moment,
    /// With [`Pick::Span`], the end the phrase writes as a range or a length.
    pub end: Option<Moment>,
    /// What was guessed.
    pub assumed: Assumed,
}

/// Why a phrase couldn't be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(
    target_arch = "wasm32",
    derive(serde::Serialize),
    serde(rename_all = "camelCase")
)]
pub enum Error {
    /// The phrase isn't a date or time this can read.
    #[error("not a date or time this can read")]
    Unrecognized,
    /// The phrase repeats, as in "every friday".
    #[error("repeating dates aren't read yet")]
    Repeating,
    /// Two dates or two times where one belongs, as in "tomorrow friday 3pm 4pm".
    #[error("two dates or times where one belongs")]
    Conflict,
    /// No such day, as in "feb 30".
    #[error("no such date")]
    InvalidDate,
    /// No such time, as in "13pm" or "3:75".
    #[error("no such time")]
    InvalidTime,
    /// A weekday written beside a date it doesn't fall on.
    #[error("the weekday doesn't fall on that date")]
    WeekdayMismatch,
    /// A length in hours or minutes on a day with no start time.
    #[error("a length in hours or minutes needs a start time")]
    DurationWithoutTime,
    /// A range whose end comes before its start.
    #[error("the range ends before it starts")]
    EndBeforeStart,
    /// A date beyond what the calendar can represent.
    #[error("the date is out of range")]
    OutOfRange,
}

/// Reads `phrase` at `now`, the reader's local wall-clock time, taking the
/// part of it that `pick` names. A date written without a time is at
/// `default_time` when one is given, and otherwise a whole day.
pub fn read(
    phrase: &str,
    now: NaiveDateTime,
    pick: Pick,
    default_time: Option<NaiveTime>,
) -> Result<Reading, Error> {
    read_with(
        phrase,
        now,
        pick,
        default_time,
        resolve::Guess::BusinessHours,
    )
}

/// Reads `phrase` like [`read`], with a guessed am or pm the other way
/// round: `at 3` is 3am rather than 3pm, `at 9` 9pm rather than 9am, and
/// `at 12` midnight rather than noon. It reads the same as [`read`] when
/// nothing was guessed, so offer it only beside a reading whose
/// [`Assumed::meridiem`] is set.
pub fn read_other_meridiem(
    phrase: &str,
    now: NaiveDateTime,
    pick: Pick,
    default_time: Option<NaiveTime>,
) -> Result<Reading, Error> {
    read_with(phrase, now, pick, default_time, resolve::Guess::Opposite)
}

fn read_with(
    phrase: &str,
    now: NaiveDateTime,
    pick: Pick,
    default_time: Option<NaiveTime>,
    guess: resolve::Guess,
) -> Result<Reading, Error> {
    let items = grammar::items(&grammar::normalize(phrase))?;
    let phrase = phrase::Phrase::from_items(&items)?;
    resolve::resolve(&phrase, now, pick, default_time, guess)
}
