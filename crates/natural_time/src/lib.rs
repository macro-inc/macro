//! Reads English date and time phrases, such as "next friday at 3",
//! "end of month", "in 2 hours" or "nov 5-7", into calendar dates, with no
//! model or network.
//!
//! [`read`] takes the phrase, the reader's local wall-clock time and what the
//! date is for. Callers turn the result into an instant in their own time
//! zone, so the crate carries no time zone database and builds for the
//! browser.
//!
//! # How phrases are read
//!
//! - Weeks run Monday to Sunday. A bare or `this` weekday is its next
//!   occurrence, today included. `next friday` is the Friday of next week;
//!   `last friday` is the most recent Friday before today.
//! - A week, weekend, month or year is a range. A [`Purpose::Deadline`] takes
//!   its end: a week's Friday (its Sunday once that Friday has passed), a
//!   weekend's Sunday, a month's or year's last day. A reminder or an event
//!   takes its start, or today when the range has already begun.
//! - A month and day without a year is this year's, unless it passed more
//!   than a month ago; then it is next year's. `the 12th` is the next 12th.
//! - Numeric dates are month first: `11/12` is November 12.
//! - A time without am/pm guesses business hours: 1–7 is pm, 8–11 am and 12
//!   noon. In a range, the side that says am or pm settles the other, so
//!   `2-3pm` is 2pm to 3pm.
//! - Parts of the day: morning 9am, noon and lunch 12pm, afternoon 1pm, end
//!   of day 5pm, evening 6pm, night and tonight 8pm. Midnight ends its day.
//! - A time alone, or on a bare weekday, that has already passed today moves
//!   to its next occurrence.
//! - A reminder with no time is at 9am. A deadline or an event with no time is
//!   a whole day.
//! - A range end or a length (`for 45 min`) gives an event its end; a
//!   deadline takes the end, a reminder the start. `in 2 hours` is elapsed
//!   time from now.
//! - Day and month names take common abbreviations (`tues`, `thurs`, `sept`)
//!   and, for names of six letters or more, one typo (`thrusday`).
//! - Filler such as `by`, `due`, `on`, `at` and `the` is ignored.
//! - Repeating phrases (`every friday`) are not read yet.
#![deny(missing_docs)]

use chrono::{NaiveDate, NaiveDateTime, TimeDelta};

mod grammar;
mod phrase;
mod resolve;
mod words;

#[cfg(test)]
mod test;

/// What a date is for, which decides how a week, a month or a range becomes
/// one date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    /// A task's due date: the end of a week, month or range.
    Deadline,
    /// When a reminder shows up: the start, at 9am when no time is written.
    Reminder,
    /// A calendar event: the start, and the end when one is written.
    Event,
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
pub struct Assumed {
    /// am or pm was guessed from business hours.
    pub meridiem: bool,
    /// The year wasn't written, and the date is past or not in this year.
    pub year: bool,
    /// The time is the reminder default, 9am.
    pub time: bool,
}

/// Where a phrase lands on the calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reading {
    /// The date or time the phrase gives for its purpose.
    pub start: Moment,
    /// An event's end, when the phrase gives a range or a length.
    pub end: Option<Moment>,
    /// What was guessed.
    pub assumed: Assumed,
}

/// Why a phrase couldn't be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
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

/// Reads `phrase` at `now`, the reader's local wall-clock time, for `purpose`.
pub fn read(phrase: &str, now: NaiveDateTime, purpose: Purpose) -> Result<Reading, Error> {
    let items = grammar::items(&grammar::normalize(phrase))?;
    let phrase = phrase::Phrase::from_items(&items)?;
    resolve::resolve(&phrase, now, purpose)
}
