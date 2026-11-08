//! What a phrase says, before it is placed on the calendar: each side of a
//! range with its date and time, plus a length or an elapsed offset.
use chrono::Weekday;

use crate::Error;
use crate::grammar::Item;

/// Which occurrence of a weekday.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WeekRef {
    /// Bare or `this`: the next occurrence, today included.
    Upcoming,
    /// `next`: in the following Monday–Sunday week.
    Next,
    /// `last`: the most recent occurrence before today.
    Last,
    /// In the week this many weeks from the current one: `friday next week`.
    Week(i32),
}

/// The first or last day of a period.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Edge {
    Start,
    End,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Period {
    Week,
    Month,
    Year,
}

/// A single day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DayRef {
    /// Days from today: `tomorrow`, `in 3 days`, `2 weeks ago`.
    Relative(i64),
    /// Calendar months from today: `in a month`.
    Months(i32),
    Weekday(Weekday, WeekRef),
    /// A month and day, with the year when written.
    Date {
        month: u32,
        day: u32,
        year: Option<i32>,
    },
    /// `the 12th`: the next such day of a month.
    DayOfMonth(u32),
    /// `end of next month`: an edge of the period this many periods away.
    Edge(Edge, Period, i32),
}

/// A run of days, counted in periods from the current one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Span {
    Week(i32),
    Weekend(i32),
    Month(i32),
    NamedMonth { month: u32, year: Option<i32> },
    Year(i32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DateRef {
    Day(DayRef),
    Span(Span),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Meridiem {
    Am,
    Pm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Daypart {
    Morning,
    Noon,
    Afternoon,
    EndOfDay,
    Evening,
    Night,
    Midnight,
}

/// A written clock time, before am/pm is settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Clock {
    pub(crate) hour: u32,
    pub(crate) minute: u32,
    pub(crate) meridiem: Option<Meridiem>,
    /// Written as a 24-hour time: with a leading zero, as hour 0, or 13 and up.
    pub(crate) exact: bool,
    /// A lone number, which a range may read as a day of the month instead.
    pub(crate) bare: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Time {
    pub(crate) clock: Option<Clock>,
    pub(crate) daypart: Option<Daypart>,
}

/// How long an event lasts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Length {
    Minutes(i64),
    Days(i64),
}

/// One side of a range, or the whole phrase when it has no range.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Side {
    pub(crate) date: Option<DateRef>,
    /// A weekday written beside a date, which the date must fall on.
    pub(crate) weekday: Option<Weekday>,
    pub(crate) time: Option<Time>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Phrase {
    pub(crate) start: Side,
    pub(crate) end: Option<Side>,
    pub(crate) length: Option<Length>,
    /// Elapsed minutes from now: `in 2 hours`.
    pub(crate) offset: Option<i64>,
}

impl Phrase {
    /// Combines items written in any order into the sides of a range.
    pub(crate) fn from_items(items: &[Item]) -> Result<Self, Error> {
        if items.contains(&Item::Repeat) {
            return Err(Error::Repeating);
        }
        // A leading "until" or "to" only introduces the date.
        let items = match items {
            [Item::To, rest @ ..] => rest,
            items => items,
        };
        let mut sides = items.split(|item| *item == Item::To);
        let first = sides.next().unwrap_or_default();
        let second = sides.next();
        if sides.next().is_some() {
            return Err(Error::Conflict);
        }

        let mut phrase = Self {
            start: Side::default(),
            end: None,
            length: None,
            offset: None,
        };
        for item in first {
            match *item {
                Item::Duration(length) if phrase.length.is_none() => phrase.length = Some(length),
                Item::Offset(minutes) if phrase.offset.is_none() => phrase.offset = Some(minutes),
                item => phrase.start.add(item)?,
            }
        }
        if let Some(items) = second {
            let mut end = Side::default();
            for item in items {
                end.add(*item)?;
            }
            phrase.end = Some(end);
        }
        phrase.settle_range()?;

        let has_start = phrase.start.date.is_some() || phrase.start.time.is_some();
        match phrase.offset {
            Some(_) if has_start || phrase.end.is_some() => Err(Error::Conflict),
            None if !has_start => Err(Error::Unrecognized),
            _ => Ok(phrase),
        }
    }

    /// Lets each side of a range borrow what only the other side wrote.
    fn settle_range(&mut self) -> Result<(), Error> {
        let Some(end) = &mut self.end else {
            return Ok(());
        };
        if self.length.is_some() {
            return Err(Error::Conflict);
        }
        // "nov 5-7", "5-7 nov", "nov 5th-7th": a lone number on one side is a
        // day in the other side's month.
        if let (Some((month, year)), Some(day)) = (month_of(&self.start), lone_day(end)) {
            end.date = Some(DateRef::Day(DayRef::Date { month, day, year }));
            end.time = None;
        } else if let (Some(day), Some((month, year))) = (lone_day(&self.start), month_of(end)) {
            self.start.date = Some(DateRef::Day(DayRef::Date { month, day, year }));
            self.start.time = None;
        }
        // "2 to 3pm friday": a date written after a time range covers both.
        if self.start.date.is_none() && self.start.time.is_some() && end.time.is_some() {
            self.start.date = end.date.take();
            self.start.weekday = end.weekday.take();
        }
        if end.date.is_none() && end.time.is_none() {
            return Err(Error::Unrecognized);
        }
        Ok(())
    }
}

impl Side {
    fn add(&mut self, item: Item) -> Result<(), Error> {
        match item {
            Item::Day(day) => self.set_date(DateRef::Day(day)),
            Item::Span(span) => self.set_date(DateRef::Span(span)),
            Item::Clock(clock) => {
                let time = self.time.get_or_insert_default();
                match time.clock.replace(clock) {
                    None => Ok(()),
                    Some(_) => Err(Error::Conflict),
                }
            }
            Item::Daypart(part) => {
                let time = self.time.get_or_insert_default();
                match time.daypart.replace(part) {
                    None => Ok(()),
                    Some(_) => Err(Error::Conflict),
                }
            }
            Item::Duration(_) | Item::Offset(_) | Item::To | Item::Repeat => Err(Error::Conflict),
        }
    }

    fn set_date(&mut self, date: DateRef) -> Result<(), Error> {
        use DateRef::{Day, Span as Run};
        self.date = Some(match (self.date, date) {
            (None, date) => date,
            // "friday next week", "next week on friday"
            (Some(Day(DayRef::Weekday(day, WeekRef::Upcoming))), Run(Span::Week(weeks)))
            | (Some(Run(Span::Week(weeks))), Day(DayRef::Weekday(day, WeekRef::Upcoming))) => {
                Day(DayRef::Weekday(day, WeekRef::Week(weeks)))
            }
            // "friday november 13": the date must fall on that weekday.
            (Some(Day(DayRef::Weekday(day, WeekRef::Upcoming))), Day(other))
                if self.weekday.is_none() =>
            {
                self.weekday = Some(day);
                Day(other)
            }
            (Some(Day(other)), Day(DayRef::Weekday(day, WeekRef::Upcoming)))
                if self.weekday.is_none() =>
            {
                self.weekday = Some(day);
                Day(other)
            }
            _ => return Err(Error::Conflict),
        });
        Ok(())
    }
}

/// The month of a side that is only a month and day.
fn month_of(side: &Side) -> Option<(u32, Option<i32>)> {
    match (side.date, side.time) {
        (Some(DateRef::Day(DayRef::Date { month, year, .. })), None) => Some((month, year)),
        _ => None,
    }
}

/// A side that is only a day of the month, or a lone number that could be one.
fn lone_day(side: &Side) -> Option<u32> {
    match (side.date, side.time, side.weekday) {
        (Some(DateRef::Day(DayRef::DayOfMonth(day))), None, None) => Some(day),
        (
            None,
            Some(Time {
                clock: Some(Clock {
                    hour, bare: true, ..
                }),
                daypart: None,
            }),
            None,
        ) if (1..=31).contains(&hour) => Some(hour),
        _ => None,
    }
}
