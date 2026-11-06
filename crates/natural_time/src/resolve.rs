//! Places a [`Phrase`] on the calendar and takes the part a [`Pick`] names. The rules are listed
//! in the crate documentation.
use chrono::{Datelike, Months, NaiveDate, NaiveDateTime, NaiveTime, TimeDelta, Weekday};

use crate::phrase::{
    DateRef, DayRef, Daypart, Edge, Length, Meridiem, Period, Phrase, Side, Span, Time, WeekRef,
};
use crate::{Assumed, Error, Moment, Pick, Reading};

/// How far back a month and day may lie and still be this year's.
const RECENT_MONTHS: u32 = 1;
/// How many years ahead to look for a month and day, enough to reach Feb 29.
const LEAP_YEARS: i32 = 8;

/// A wall-clock time, and whether it falls after the day's midnight, as
/// "midnight" and "tonight at 1" do.
#[derive(Debug, Clone, Copy)]
struct Wall {
    time: NaiveTime,
    next_day: bool,
}

/// A written time, before am/pm is settled.
#[derive(Debug, Clone, Copy)]
enum Written {
    Fixed(Wall),
    Loose { hour: u32, minute: u32 },
}

/// How a time that already passed today moves forward.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Roll {
    Never,
    Day,
    Week,
}

/// Which occurrence of a yearless date or weekday a side means.
#[derive(Debug, Clone, Copy)]
enum Anchor {
    /// The start of a phrase, read against today.
    Today,
    /// The end of a range: on or after its start.
    From(NaiveDate),
}

/// A day or a wall-clock time; [`Moment`] without elapsed offsets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Point {
    Day(NaiveDate),
    At(NaiveDateTime),
}

impl Point {
    fn first_moment(self) -> NaiveDateTime {
        match self {
            Self::Day(day) => day.and_time(NaiveTime::MIN),
            Self::At(at) => at,
        }
    }

    fn moment(self) -> Moment {
        match self {
            Self::Day(day) => Moment::Day(day),
            Self::At(at) => Moment::At(at),
        }
    }
}

pub(crate) fn resolve(
    phrase: &Phrase,
    now: NaiveDateTime,
    pick: Pick,
    default_time: Option<NaiveTime>,
) -> Result<Reading, Error> {
    let mut assumed = Assumed::default();
    if let Some(minutes) = phrase.offset {
        let start = TimeDelta::minutes(minutes);
        let end = match (pick, phrase.length) {
            (Pick::Span, Some(Length::Minutes(length))) => {
                Some(Moment::After(start + TimeDelta::minutes(length)))
            }
            (Pick::Span, Some(Length::Days(days))) => {
                Some(Moment::After(start + TimeDelta::days(days)))
            }
            _ => None,
        };
        return Ok(Reading {
            start: Moment::After(start),
            end,
            assumed,
        });
    }

    let today = now.date();
    let (mut date, roll) = start_date(&phrase.start, today, pick, &mut assumed)?;
    let (start_wall, end_wall) = walls(
        phrase.start.time.as_ref(),
        phrase.end.as_ref().and_then(|side| side.time.as_ref()),
        &mut assumed,
    )?;
    let start_wall = match (start_wall, default_time) {
        (None, Some(time)) => {
            assumed.time = true;
            Some(Wall {
                time,
                next_day: false,
            })
        }
        (wall, _) => wall,
    };
    if let Some(wall) = start_wall
        && !wall.next_day
        && date == today
        && wall.time < now.time()
    {
        date = match roll {
            Roll::Never => date,
            Roll::Day => add_days(date, 1)?,
            Roll::Week => add_days(date, 7)?,
        };
    }
    let start = point(date, start_wall)?;
    let end = match &phrase.end {
        Some(side) => Some(range_end(side, start, date, end_wall, today, &mut assumed)?),
        None => phrase
            .length
            .map(|length| lasting(start, length))
            .transpose()?,
    };

    let (start, end) = match (pick, end) {
        (Pick::End, Some(end)) => (end, None),
        (Pick::Start, _) => (start, None),
        (_, end) => (start, end),
    };
    Ok(Reading {
        start: start.moment(),
        end: end.map(Point::moment),
        assumed,
    })
}

/// The day a phrase starts on, and how it moves when its time has passed.
fn start_date(
    side: &Side,
    today: NaiveDate,
    pick: Pick,
    assumed: &mut Assumed,
) -> Result<(NaiveDate, Roll), Error> {
    let (date, roll) = match side.date {
        None if side.time.is_some() => (today, Roll::Day),
        None => return Err(Error::Unrecognized),
        Some(DateRef::Day(day)) => {
            let roll = match day {
                DayRef::Weekday(_, WeekRef::Upcoming) => Roll::Week,
                _ => Roll::Never,
            };
            (day_date(day, today, Anchor::Today, assumed)?, roll)
        }
        Some(DateRef::Span(span)) => {
            let (first, last) = span_days(span, today, assumed)?;
            let date = match pick {
                Pick::End => match span {
                    Span::Week(_) => week_due(first, today)?,
                    Span::Weekend(_) | Span::Month(_) | Span::NamedMonth { .. } | Span::Year(_) => {
                        last
                    }
                },
                Pick::Start | Pick::Span if (first..=last).contains(&today) => today,
                Pick::Start | Pick::Span => first,
            };
            (date, Roll::Never)
        }
    };
    check_weekday(date, side.weekday)?;
    Ok((date, roll))
}

/// Where a range ends, on or after its start.
fn range_end(
    side: &Side,
    start: Point,
    start_date: NaiveDate,
    wall: Option<Wall>,
    today: NaiveDate,
    assumed: &mut Assumed,
) -> Result<Point, Error> {
    let date = match side.date {
        None => start_date,
        Some(DateRef::Day(day)) => day_date(day, today, Anchor::From(start_date), assumed)?,
        Some(DateRef::Span(_)) => return Err(Error::Conflict),
    };
    check_weekday(date, side.weekday)?;
    let end = point(date, wall)?;
    match (start, end) {
        // A time range that ends earlier than it starts runs past midnight.
        (Point::At(start), Point::At(end)) if end <= start && side.date.is_none() => end
            .checked_add_signed(TimeDelta::days(1))
            .map(Point::At)
            .ok_or(Error::OutOfRange),
        _ if end.first_moment() < start.first_moment() => Err(Error::EndBeforeStart),
        _ => Ok(end),
    }
}

/// Where an event of `length` that starts at `start` ends.
fn lasting(start: Point, length: Length) -> Result<Point, Error> {
    match (start, length) {
        (Point::At(at), Length::Minutes(minutes)) => at
            .checked_add_signed(TimeDelta::minutes(minutes))
            .map(Point::At)
            .ok_or(Error::OutOfRange),
        (Point::At(at), Length::Days(days)) => at
            .checked_add_signed(TimeDelta::days(days))
            .map(Point::At)
            .ok_or(Error::OutOfRange),
        // An all-day event of three days covers its first day and two more.
        (Point::Day(day), Length::Days(days)) => add_days(day, days - 1).map(Point::Day),
        (Point::Day(_), Length::Minutes(_)) => Err(Error::DurationWithoutTime),
    }
}

fn day_date(
    day: DayRef,
    today: NaiveDate,
    anchor: Anchor,
    assumed: &mut Assumed,
) -> Result<NaiveDate, Error> {
    let base = match anchor {
        Anchor::Today => today,
        Anchor::From(start) => start,
    };
    match day {
        DayRef::Relative(days) => add_days(today, days),
        DayRef::Months(months) => add_months(today, months),
        DayRef::Weekday(weekday, week) => weekday_date(weekday, week, base),
        DayRef::Date {
            month,
            day,
            year: Some(year),
        } => NaiveDate::from_ymd_opt(year, month, day).ok_or(Error::InvalidDate),
        DayRef::Date {
            month,
            day,
            year: None,
        } => {
            // This year's, unless it passed over a month ago; a range's end
            // is the first one on or after its start.
            let earliest = match anchor {
                Anchor::Today => today
                    .checked_sub_months(Months::new(RECENT_MONTHS))
                    .ok_or(Error::OutOfRange)?,
                Anchor::From(start) => start,
            };
            let date = (0..=LEAP_YEARS)
                .filter_map(|years| NaiveDate::from_ymd_opt(base.year() + years, month, day))
                .find(|date| *date >= earliest)
                .ok_or(Error::InvalidDate)?;
            if date < today || date.year() != today.year() {
                assumed.year = true;
            }
            Ok(date)
        }
        DayRef::DayOfMonth(day) => {
            let first = first_of_month(base)?;
            (0..=12)
                .filter_map(|months| first.checked_add_months(Months::new(months))?.with_day(day))
                .find(|date| *date >= base)
                .ok_or(Error::InvalidDate)
        }
        DayRef::Edge(edge, period, periods) => edge_date(edge, period, periods, today),
    }
}

fn weekday_date(weekday: Weekday, week: WeekRef, base: NaiveDate) -> Result<NaiveDate, Error> {
    let current = i64::from(base.weekday().num_days_from_monday());
    let wanted = i64::from(weekday.num_days_from_monday());
    let offset = match week {
        WeekRef::Upcoming => (wanted - current).rem_euclid(7),
        WeekRef::Next => 7 + wanted - current,
        WeekRef::Last => -((current - wanted - 1).rem_euclid(7) + 1),
        WeekRef::Week(weeks) => wanted - current + 7 * i64::from(weeks),
    };
    add_days(base, offset)
}

fn edge_date(
    edge: Edge,
    period: Period,
    periods: i32,
    today: NaiveDate,
) -> Result<NaiveDate, Error> {
    match period {
        Period::Week => {
            let monday = week_start(today, periods)?;
            match edge {
                Edge::Start => Ok(monday),
                Edge::End => week_due(monday, today),
            }
        }
        Period::Month => {
            let (first, last) = month_days(add_months(first_of_month(today)?, periods)?)?;
            Ok(match edge {
                Edge::Start => first,
                Edge::End => last,
            })
        }
        Period::Year => {
            let year = today.year() + periods;
            match edge {
                Edge::Start => NaiveDate::from_ymd_opt(year, 1, 1),
                Edge::End => NaiveDate::from_ymd_opt(year, 12, 31),
            }
            .ok_or(Error::OutOfRange)
        }
    }
}

/// The first and last day of a span.
fn span_days(
    span: Span,
    today: NaiveDate,
    assumed: &mut Assumed,
) -> Result<(NaiveDate, NaiveDate), Error> {
    match span {
        Span::Week(weeks) => {
            let monday = week_start(today, weeks)?;
            Ok((monday, add_days(monday, 6)?))
        }
        Span::Weekend(weeks) => {
            let monday = week_start(today, weeks)?;
            Ok((add_days(monday, 5)?, add_days(monday, 6)?))
        }
        Span::Month(months) => month_days(add_months(first_of_month(today)?, months)?),
        Span::NamedMonth { month, year } => {
            let year = match year {
                Some(year) => year,
                None => {
                    let year = if month >= today.month() {
                        today.year()
                    } else {
                        today.year() + 1
                    };
                    assumed.year |= year != today.year();
                    year
                }
            };
            month_days(NaiveDate::from_ymd_opt(year, month, 1).ok_or(Error::InvalidDate)?)
        }
        Span::Year(years) => {
            let year = today.year() + years;
            Ok((
                NaiveDate::from_ymd_opt(year, 1, 1).ok_or(Error::OutOfRange)?,
                NaiveDate::from_ymd_opt(year, 12, 31).ok_or(Error::OutOfRange)?,
            ))
        }
    }
}

/// A week is due on its Friday, or on its Sunday once that Friday has passed.
fn week_due(monday: NaiveDate, today: NaiveDate) -> Result<NaiveDate, Error> {
    let friday = add_days(monday, 4)?;
    let sunday = add_days(monday, 6)?;
    Ok(if friday < today && today <= sunday {
        sunday
    } else {
        friday
    })
}

/// The Monday of the week `weeks` from the current one.
fn week_start(today: NaiveDate, weeks: i32) -> Result<NaiveDate, Error> {
    add_days(
        today,
        7 * i64::from(weeks) - i64::from(today.weekday().num_days_from_monday()),
    )
}

fn first_of_month(date: NaiveDate) -> Result<NaiveDate, Error> {
    date.with_day(1).ok_or(Error::OutOfRange)
}

fn month_days(first: NaiveDate) -> Result<(NaiveDate, NaiveDate), Error> {
    let last = first
        .checked_add_months(Months::new(1))
        .and_then(|next| next.pred_opt())
        .ok_or(Error::OutOfRange)?;
    Ok((first, last))
}

fn add_days(date: NaiveDate, days: i64) -> Result<NaiveDate, Error> {
    date.checked_add_signed(TimeDelta::try_days(days).ok_or(Error::OutOfRange)?)
        .ok_or(Error::OutOfRange)
}

fn add_months(date: NaiveDate, months: i32) -> Result<NaiveDate, Error> {
    let count = Months::new(months.unsigned_abs());
    if months >= 0 {
        date.checked_add_months(count)
    } else {
        date.checked_sub_months(count)
    }
    .ok_or(Error::OutOfRange)
}

fn check_weekday(date: NaiveDate, weekday: Option<Weekday>) -> Result<(), Error> {
    match weekday {
        Some(weekday) if date.weekday() != weekday => Err(Error::WeekdayMismatch),
        _ => Ok(()),
    }
}

fn clock(hour: u32, minute: u32) -> Result<NaiveTime, Error> {
    NaiveTime::from_hms_opt(hour, minute, 0).ok_or(Error::InvalidTime)
}

fn point(date: NaiveDate, wall: Option<Wall>) -> Result<Point, Error> {
    let Some(wall) = wall else {
        return Ok(Point::Day(date));
    };
    let date = if wall.next_day {
        add_days(date, 1)?
    } else {
        date
    };
    Ok(Point::At(date.and_time(wall.time)))
}

/// Settles am/pm for a start and an end time together: the side that says
/// it decides the other, and a time that says neither guesses business hours.
fn walls(
    start: Option<&Time>,
    end: Option<&Time>,
    assumed: &mut Assumed,
) -> Result<(Option<Wall>, Option<Wall>), Error> {
    let start = start.map(written).transpose()?;
    let end = end.map(written).transpose()?;
    Ok(match (start, end) {
        (Some(Written::Loose { hour, minute }), Some(Written::Fixed(end))) => {
            (Some(before(hour, minute, end)?), Some(end))
        }
        (Some(start), Some(Written::Loose { hour, minute })) => {
            let start = settle(start, assumed)?;
            (Some(start), Some(after(hour, minute, start)?))
        }
        (start, end) => (
            start.map(|start| settle(start, assumed)).transpose()?,
            end.map(|end| settle(end, assumed)).transpose()?,
        ),
    })
}

fn settle(written: Written, assumed: &mut Assumed) -> Result<Wall, Error> {
    match written {
        Written::Fixed(wall) => Ok(wall),
        Written::Loose { hour, minute } => {
            assumed.meridiem = true;
            // 1–7 is pm, 8–11 am, 12 noon.
            let hour = if hour <= 7 { hour + 12 } else { hour };
            Ok(Wall {
                time: clock(hour, minute)?,
                next_day: false,
            })
        }
    }
}

/// The am or pm reading of `hour`, both in time order.
fn readings(hour: u32, minute: u32) -> Result<[NaiveTime; 2], Error> {
    Ok([clock(hour % 12, minute)?, clock(hour % 12 + 12, minute)?])
}

/// The later reading of a range's start that still comes before its end:
/// `11-1pm` starts at 11am, `2-3pm` at 2pm. When neither does, the range
/// runs past midnight from the pm reading: `11-1am`.
fn before(hour: u32, minute: u32, end: Wall) -> Result<Wall, Error> {
    let [am, pm] = readings(hour, minute)?;
    let time = if end.next_day || pm < end.time || am >= end.time {
        pm
    } else {
        am
    };
    Ok(Wall {
        time,
        next_day: false,
    })
}

/// The earlier reading of a range's end that comes after its start:
/// `10am-2` ends at 2pm, `9pm-11` at 11pm.
fn after(hour: u32, minute: u32, start: Wall) -> Result<Wall, Error> {
    let [am, pm] = readings(hour, minute)?;
    let time = if am > start.time || pm <= start.time {
        am
    } else {
        pm
    };
    Ok(Wall {
        time,
        next_day: start.next_day,
    })
}

/// A written time as far as it can be settled on its own.
fn written(time: &Time) -> Result<Written, Error> {
    let Some(clock_time) = time.clock else {
        return time
            .daypart
            .map(|part| default_wall(part).map(Written::Fixed))
            .unwrap_or(Err(Error::Unrecognized));
    };
    let (hour, minute) = (clock_time.hour, clock_time.minute);
    if minute > 59 {
        return Err(Error::InvalidTime);
    }
    let fixed = |hour, next_day| {
        Ok(Written::Fixed(Wall {
            time: clock(hour, minute)?,
            next_day,
        }))
    };
    if let Some(meridiem) = clock_time.meridiem {
        if !(1..=12).contains(&hour) {
            return Err(Error::InvalidTime);
        }
        let pm = if meridiem == Meridiem::Pm { 12 } else { 0 };
        return fixed(hour % 12 + pm, false);
    }
    if hour > 23 {
        return Err(Error::InvalidTime);
    }
    if clock_time.exact {
        return fixed(hour, false);
    }
    // From here the hour is 1–12.
    match time.daypart {
        None => Ok(Written::Loose { hour, minute }),
        Some(Daypart::Morning) => fixed(hour % 12, false),
        Some(Daypart::Noon) if hour == 12 => fixed(12, false),
        Some(Daypart::Midnight) if hour == 12 => fixed(0, true),
        Some(Daypart::Noon | Daypart::Midnight) => Err(Error::InvalidTime),
        Some(Daypart::Afternoon | Daypart::EndOfDay | Daypart::Evening) => {
            fixed(hour % 12 + 12, false)
        }
        // Late at night runs into the next morning: "tonight at 1" is 1am.
        Some(Daypart::Night) if hour == 12 => fixed(0, true),
        Some(Daypart::Night) if hour <= 4 => fixed(hour, true),
        Some(Daypart::Night) => fixed(hour + 12, false),
    }
}

fn default_wall(part: Daypart) -> Result<Wall, Error> {
    let (hour, next_day) = match part {
        Daypart::Morning => (9, false),
        Daypart::Noon => (12, false),
        Daypart::Afternoon => (13, false),
        Daypart::EndOfDay => (17, false),
        Daypart::Evening => (18, false),
        Daypart::Night => (20, false),
        Daypart::Midnight => (0, true),
    };
    Ok(Wall {
        time: clock(hour, 0)?,
        next_day,
    })
}
