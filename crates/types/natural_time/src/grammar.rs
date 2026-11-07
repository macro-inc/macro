//! Grammar: a normalized phrase becomes a flat list of items. Items may come
//! in any order ("3pm tomorrow", "tomorrow at 3pm"); [`Phrase`] combines them.
//!
//! [`Phrase`]: crate::phrase::Phrase
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_while1},
    character::complete::{char, digit1, one_of, space0},
    combinator::{eof, map, map_opt, opt, peek, recognize, rest, value, verify},
    multi::many0,
    sequence::{preceded, terminated},
};

use crate::Error;
use crate::phrase::{Clock, DayRef, Daypart, Edge, Length, Meridiem, Period, Span, WeekRef};
use crate::words::{self, RelativeWord, Unit};

/// One thing a phrase says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Item {
    Day(DayRef),
    Span(Span),
    Clock(Clock),
    Daypart(Daypart),
    /// `for 45 minutes`.
    Duration(Length),
    /// Elapsed minutes from now: `in 2 hours`.
    Offset(i64),
    /// A range separator: `-`, `to`, `until`, `through`.
    To,
    /// A repeating phrase, such as `every friday`, which isn't read yet.
    Repeat,
}

type Res<'a, T> = IResult<&'a str, T>;
type NomError<'a> = nom::error::Error<&'a str>;

const REPLACEMENTS: [(&str, &str); 9] = [
    ("a.m.", "am"),
    ("p.m.", "pm"),
    ("a.m", "am"),
    ("p.m", "pm"),
    ("o'clock", "oclock"),
    ("o\u{2019}clock", "oclock"),
    ("-of-", " of "),
    ("-the-", " the "),
    ("mid-day", "midday"),
];

/// Ways of saying 5pm, longest first so the full phrase is taken.
const END_OF_DAY: [&str; 14] = [
    "end of the business day",
    "end of the work day",
    "end of business day",
    "end of the workday",
    "close of business",
    "end of business",
    "end of the day",
    "end of workday",
    "end of work",
    "close of play",
    "end of day",
    "eod",
    "eob",
    "cob",
];

/// Words describing a repeat; the phrase is then not read.
const REPEAT_WORDS: [&str; 15] = [
    "every",
    "each",
    "daily",
    "weekly",
    "monthly",
    "yearly",
    "annually",
    "biweekly",
    "fortnightly",
    "hourly",
    "nightly",
    "everyday",
    "weekdays",
    "weekends",
    "recurring",
];

const FILLER_PHRASES: [&str; 3] = ["no later than", "not later than", "or so"];

const FILLER_WORDS: &[&str] = &[
    "by",
    "on",
    "at",
    "due",
    "before",
    "the",
    "of",
    "from",
    "around",
    "about",
    "approx",
    "approximately",
    "roughly",
    "latest",
    "for",
    "starting",
    "sometime",
];

/// Lowercases the phrase and reduces punctuation to what the grammar reads:
/// single spaces, range dashes, date slashes, and the `:` or `.` inside a
/// time or a decimal.
pub(crate) fn normalize(phrase: &str) -> String {
    let lower = REPLACEMENTS
        .iter()
        .fold(phrase.to_lowercase(), |text, (from, to)| {
            text.replace(from, to)
        });
    let chars: Vec<char> = lower.chars().collect();
    let digit_at = |index: Option<usize>| {
        index
            .and_then(|index| chars.get(index))
            .is_some_and(char::is_ascii_digit)
    };
    let mut out = String::with_capacity(lower.len());
    for (index, &c) in chars.iter().enumerate() {
        match c {
            '\u{2013}' | '\u{2014}' | '\u{2212}' | '-' => out.push('-'),
            '.' | ':' if digit_at(index.checked_sub(1)) && digit_at(index.checked_add(1)) => {
                out.push(c);
            }
            '/' => out.push(c),
            c if c.is_alphanumeric() => out.push(c),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Splits a normalized phrase into items.
pub(crate) fn items(input: &str) -> Result<Vec<Item>, Error> {
    terminated(many0(preceded(space0, element)), (space0, eof))
        .parse(input)
        .map(|(_, found)| found.into_iter().flatten().collect())
        .map_err(|_| Error::Unrecognized)
}

/// The next item. Earlier alternatives win, so longer readings come first:
/// "3 days ago" before the clock "3", "nov 12" before the clock "12".
fn element(i: &str) -> Res<'_, Vec<Item>> {
    alt((
        one(repeat),
        one(end_of_day),
        relative_day,
        offset,
        one(duration),
        one(numeric_date),
        one(named_date),
        one(period),
        one(weekday),
        today_daypart,
        one(daypart),
        one(clock),
        one(separator),
        filler,
    ))
    .parse(i)
}

fn one<'a>(
    parser: impl Parser<&'a str, Output = Item, Error = NomError<'a>>,
) -> impl Parser<&'a str, Output = Vec<Item>, Error = NomError<'a>> {
    map(parser, |item| vec![item])
}

/// Words and numbers end at a space, a range dash or the end of the phrase.
fn boundary(i: &str) -> Res<'_, ()> {
    value((), peek(alt((eof, tag(" "), tag("-"))))).parse(i)
}

fn word(i: &str) -> Res<'_, &str> {
    terminated(take_while1(|c: char| c.is_ascii_alphanumeric()), boundary).parse(i)
}

fn kw<'a>(expected: &'static str) -> impl Parser<&'a str, Output = &'a str, Error = NomError<'a>> {
    verify(word, move |found: &str| found == expected)
}

fn kws<'a>(
    expected: &'static [&'static str],
) -> impl Parser<&'a str, Output = &'a str, Error = NomError<'a>> {
    verify(word, move |found: &str| expected.contains(&found))
}

/// The first of `phrases` the input starts with, as whole words.
fn any_phrase<'a>(
    phrases: &'static [&'static str],
) -> impl Parser<&'a str, Output = &'a str, Error = NomError<'a>> {
    move |i: &'a str| {
        phrases
            .iter()
            .find_map(|phrase| terminated(tag(*phrase), boundary).parse(i).ok())
            .ok_or_else(|| nom::Err::Error(NomError::new(i, nom::error::ErrorKind::Tag)))
    }
}

fn sp(i: &str) -> Res<'_, char> {
    char(' ').parse(i)
}

/// `parser` and the space after it.
fn spaced<'a, O>(
    parser: impl Parser<&'a str, Output = O, Error = NomError<'a>>,
) -> impl Parser<&'a str, Output = O, Error = NomError<'a>> {
    terminated(parser, sp)
}

/// Digits, with how many were written.
fn digits(i: &str) -> Res<'_, (u32, usize)> {
    map_opt(digit1, |d: &str| Some((d.parse().ok()?, d.len()))).parse(i)
}

/// One or two digits.
fn small(i: &str) -> Res<'_, (u32, usize)> {
    verify(digits, |(_, len)| *len <= 2).parse(i)
}

/// A four-digit year.
fn year(i: &str) -> Res<'_, i32> {
    map_opt(terminated(digits, boundary), |(year, len)| {
        (len == 4 && (1900..2200).contains(&year)).then(|| i32::try_from(year).ok())?
    })
    .parse(i)
}

fn suffix(i: &str) -> Res<'_, &str> {
    alt((tag("st"), tag("nd"), tag("rd"), tag("th"))).parse(i)
}

fn valid_day(day: &u32) -> bool {
    (1..=31).contains(day)
}

/// A day of the month: `12`, `12th` or `twelfth`.
fn day_number(i: &str) -> Res<'_, u32> {
    verify(
        alt((
            map(terminated(small, (opt(suffix), boundary)), |(day, _)| day),
            map_opt(word, words::ordinal),
        )),
        valid_day,
    )
    .parse(i)
}

/// A day of the month that says it is one: `12th` or `twelfth`, not `12`.
fn ordinal_day(i: &str) -> Res<'_, u32> {
    verify(
        alt((
            map(terminated(small, (suffix, boundary)), |(day, _)| day),
            map_opt(word, words::ordinal),
        )),
        valid_day,
    )
    .parse(i)
}

fn month_name(i: &str) -> Res<'_, u32> {
    map_opt(word, words::month).parse(i)
}

fn date(month: u32, day: u32, year: Option<i32>) -> Option<Item> {
    ((1..=12).contains(&month) && valid_day(&day)).then_some(Item::Day(DayRef::Date {
        month,
        day,
        year,
    }))
}

fn repeat(i: &str) -> Res<'_, Item> {
    // The rest of a repeating phrase isn't read, so it needn't parse.
    value(
        Item::Repeat,
        (
            verify(word, |w: &str| {
                REPEAT_WORDS.contains(&w) || words::weekday_plural(w)
            }),
            rest,
        ),
    )
    .parse(i)
}

fn end_of_day(i: &str) -> Res<'_, Item> {
    value(Item::Daypart(Daypart::EndOfDay), any_phrase(&END_OF_DAY)).parse(i)
}

fn is_tomorrow(w: &str) -> Option<()> {
    (words::relative(w) == Some(RelativeWord::Tomorrow)).then_some(())
}

fn is_yesterday(w: &str) -> Option<()> {
    (words::relative(w) == Some(RelativeWord::Yesterday)).then_some(())
}

/// `today`, `tonight`, `tomorrow`, `the day after tomorrow`, `later today`.
fn relative_day(i: &str) -> Res<'_, Vec<Item>> {
    let day = |days| Item::Day(DayRef::Relative(days));
    alt((
        value(
            vec![day(2)],
            (kw("day"), sp, kw("after"), sp, map_opt(word, is_tomorrow)),
        ),
        value(
            vec![day(-2)],
            (kw("day"), sp, kw("before"), sp, map_opt(word, is_yesterday)),
        ),
        value(
            vec![day(0), Item::Daypart(Daypart::EndOfDay)],
            (kw("later"), sp, kw("today")),
        ),
        map_opt(word, move |w| {
            Some(match words::relative(w)? {
                RelativeWord::Today => vec![day(0)],
                RelativeWord::Tonight => vec![day(0), Item::Daypart(Daypart::Night)],
                RelativeWord::Tomorrow => vec![day(1)],
                RelativeWord::Yesterday => vec![day(-1)],
            })
        }),
    ))
    .parse(i)
}

/// An amount: `3`, `1.5`, `a`, `two`, `a couple of`.
fn amount(i: &str) -> Res<'_, f64> {
    alt((
        value(
            2.0,
            (
                opt(spaced(kw("a"))),
                kw("couple"),
                opt(preceded(sp, kw("of"))),
            ),
        ),
        map_opt(recognize((digit1, opt((char('.'), digit1)))), |n: &str| {
            n.parse().ok()
        }),
        map_opt(word, |w| words::count(w).map(f64::from)),
    ))
    .parse(i)
}

/// A unit, which may run straight into the next amount, as in `1h30m`.
fn unit(i: &str) -> Res<'_, (Unit, u32)> {
    map_opt(
        terminated(
            take_while1(|c: char| c.is_ascii_lowercase()),
            peek(alt((eof, tag(" "), tag("-"), digit1))),
        ),
        words::unit,
    )
    .parse(i)
}

/// One amount of one unit: `3 days`, `half an hour`, `an hour and a half`.
fn term(i: &str) -> Res<'_, (f64, Unit)> {
    alt((
        map(
            (kw("half"), sp, kws(&["a", "an"]), sp, unit),
            |(.., (unit, per))| (0.5 * f64::from(per), unit),
        ),
        map(
            (
                amount,
                opt(sp),
                unit,
                sp,
                kw("and"),
                sp,
                kw("a"),
                sp,
                kw("half"),
            ),
            |(amount, _, (unit, per), ..)| ((amount + 0.5) * f64::from(per), unit),
        ),
        map((amount, opt(sp), unit), |(amount, _, (unit, per))| {
            (amount * f64::from(per), unit)
        }),
    ))
    .parse(i)
}

/// Terms added together: `1 hour 30 minutes`, `1h30m`, `2 hours and 15 min`.
fn quantity(i: &str) -> Res<'_, Vec<(f64, Unit)>> {
    map(
        (
            term,
            many0(preceded(
                opt(alt((recognize((sp, kw("and"), sp)), recognize(sp)))),
                term,
            )),
        ),
        |(first, more)| std::iter::once(first).chain(more).collect(),
    )
    .parse(i)
}

/// A whole, non-negative count, rejecting fractions such as 1.5 days.
fn whole(amount: f64) -> Option<i64> {
    (amount >= 0.0 && amount.fract() == 0.0 && amount < 1e9).then_some(amount as i64)
}

fn minutes_in(quantity: &[(f64, Unit)]) -> Option<f64> {
    quantity
        .iter()
        .map(|(amount, unit)| match unit {
            Unit::Minute => Some(*amount),
            Unit::Hour => Some(amount * 60.0),
            Unit::Day => Some(amount * 1440.0),
            Unit::Week => Some(amount * 10080.0),
            Unit::Month | Unit::Year => None,
        })
        .sum()
}

/// `in 2 hours` is elapsed time; `in 3 days` and `in a month` are calendar
/// days and months. `sign` is -1 for `ago`.
fn shifted(quantity: &[(f64, Unit)], sign: i64, from_days: i64) -> Option<Item> {
    if quantity
        .iter()
        .all(|(_, unit)| matches!(unit, Unit::Minute | Unit::Hour))
    {
        if from_days != 0 {
            return None;
        }
        return whole(minutes_in(quantity)?).map(|minutes| Item::Offset(sign * minutes));
    }
    let [(amount, unit)] = quantity else {
        return None;
    };
    let amount = sign * whole(*amount)?;
    Some(Item::Day(match unit {
        Unit::Day => DayRef::Relative(from_days + amount),
        Unit::Week => DayRef::Relative(from_days + amount * 7),
        Unit::Month if from_days == 0 => DayRef::Months(i32::try_from(amount).ok()?),
        Unit::Year if from_days == 0 => DayRef::Months(i32::try_from(amount * 12).ok()?),
        Unit::Minute | Unit::Hour | Unit::Month | Unit::Year => return None,
    }))
}

/// `in 3 days`, `within 2 weeks`, `2 hours from now`, `a week from tomorrow`,
/// `3 days ago`, `now`.
fn offset(i: &str) -> Res<'_, Vec<Item>> {
    let start = alt((
        value(0, kws(&["now", "today"])),
        value(1, map_opt(word, is_tomorrow)),
    ));
    map(
        alt((
            map_opt(preceded(spaced(kws(&["in", "within"])), quantity), |q| {
                shifted(&q, 1, 0)
            }),
            map_opt(
                (quantity, sp, kw("from"), sp, start),
                |(q, _, _, _, from)| shifted(&q, 1, from),
            ),
            map_opt(terminated(quantity, (sp, kw("ago"))), |q| {
                shifted(&q, -1, 0)
            }),
            value(Item::Offset(0), kws(&["now", "rn"])),
        )),
        |item| vec![item],
    )
    .parse(i)
}

/// `for 45 minutes`, `for an hour and a half`, `for 3 days`.
fn duration(i: &str) -> Res<'_, Item> {
    map_opt(preceded(spaced(kw("for")), quantity), |quantity| {
        let days_only = quantity
            .iter()
            .all(|(_, unit)| matches!(unit, Unit::Day | Unit::Week));
        let length = if days_only {
            Length::Days(whole(minutes_in(&quantity)? / 1440.0)?)
        } else {
            Length::Minutes(whole(minutes_in(&quantity)?)?)
        };
        match length {
            Length::Days(0) | Length::Minutes(0) => None,
            length => Some(Item::Duration(length)),
        }
    })
    .parse(i)
}

/// `2026-11-12`, `11/12`, `11/12/26`.
fn numeric_date(i: &str) -> Res<'_, Item> {
    alt((
        map_opt(
            (digits, one_of("-/"), small, one_of("-/"), small, boundary),
            |((year, len), _, (month, _), _, (day, _), ())| {
                date(month, day, Some(i32::try_from(year).ok()?)).filter(|_| len == 4)
            },
        ),
        map_opt(
            (
                small,
                char('/'),
                small,
                opt(preceded(char('/'), digits)),
                boundary,
            ),
            |((month, _), _, (day, _), year, ())| {
                let year = match year {
                    None => None,
                    Some((year, 2)) => Some(2000 + i32::try_from(year).ok()?),
                    Some((year, 4)) => Some(i32::try_from(year).ok()?),
                    Some(_) => return None,
                };
                date(month, day, year)
            },
        ),
    ))
    .parse(i)
}

/// `nov 12`, `12th of november 2027`, `december`, `in dec`, `the 12th`.
fn named_date(i: &str) -> Res<'_, Item> {
    alt((
        map_opt(
            (month_name, sp, day_number, opt(preceded(sp, year))),
            |(month, _, day, year)| date(month, day, year),
        ),
        map_opt(
            (
                day_number,
                sp,
                opt(spaced(kw("of"))),
                month_name,
                opt(preceded(sp, year)),
            ),
            |(day, _, _, month, year)| date(month, day, year),
        ),
        map(
            (opt(spaced(kw("in"))), month_name, opt(preceded(sp, year))),
            |(_, month, year)| Item::Span(Span::NamedMonth { month, year }),
        ),
        map(ordinal_day, |day| Item::Day(DayRef::DayOfMonth(day))),
    ))
    .parse(i)
}

/// `this`, `next`, `last`: how many periods from the current one.
fn relation(i: &str) -> Res<'_, i32> {
    alt((
        value(0, kw("this")),
        value(1, kws(&["next", "nxt", "following"])),
        value(-1, kws(&["last", "previous", "prev", "past"])),
    ))
    .parse(i)
}

fn period_word(i: &str) -> Res<'_, Period> {
    alt((
        value(Period::Week, kws(&["week", "wk"])),
        value(Period::Month, kws(&["month", "mo", "mth"])),
        value(Period::Year, kws(&["year", "yr"])),
    ))
    .parse(i)
}

fn after_next(i: &str) -> Res<'_, ()> {
    value((), (sp, kw("after"), sp, kw("next"))).parse(i)
}

/// `next week`, `this weekend`, `the week after next`, `end of next month`, `eow`.
fn period(i: &str) -> Res<'_, Item> {
    let edge = |edge, period| Item::Day(DayRef::Edge(edge, period, 0));
    alt((
        value(edge(Edge::End, Period::Week), kw("eow")),
        value(edge(Edge::End, Period::Month), kw("eom")),
        value(edge(Edge::End, Period::Year), kw("eoy")),
        map(
            (
                alt((
                    value(Edge::End, kw("end")),
                    value(Edge::Start, kws(&["start", "beginning", "begining", "beg"])),
                )),
                sp,
                opt(spaced(kw("of"))),
                opt(spaced(kw("the"))),
                opt(spaced(relation)),
                period_word,
            ),
            |(edge, _, _, _, periods, period)| {
                Item::Day(DayRef::Edge(edge, period, periods.unwrap_or(0)))
            },
        ),
        map((opt(spaced(relation)), kw("weekend")), |(weekends, _)| {
            Item::Span(Span::Weekend(weekends.unwrap_or(0)))
        }),
        map_opt(
            (opt(spaced(relation)), period_word, opt(after_next)),
            |(periods, period, after)| {
                let periods = match (periods, after) {
                    (_, Some(())) => 2,
                    (Some(periods), None) => periods,
                    (None, None) => return None,
                };
                Some(Item::Span(match period {
                    Period::Week => Span::Week(periods),
                    Period::Month => Span::Month(periods),
                    Period::Year => Span::Year(periods),
                }))
            },
        ),
    ))
    .parse(i)
}

fn week_ref(i: &str) -> Res<'_, WeekRef> {
    alt((
        value(WeekRef::Last, (kw("this"), sp, kw("past"))),
        value(WeekRef::Upcoming, (kw("this"), sp, kw("coming"))),
        value(WeekRef::Upcoming, kws(&["this", "coming", "upcoming"])),
        value(WeekRef::Next, kws(&["next", "nxt", "following"])),
        value(WeekRef::Last, kws(&["last", "past", "previous", "prev"])),
    ))
    .parse(i)
}

/// `friday`, `next tues`, `this past monday`, `friday after next`.
fn weekday(i: &str) -> Res<'_, Item> {
    map(
        (
            opt(spaced(week_ref)),
            map_opt(word, words::weekday),
            opt(after_next),
        ),
        |(week, day, after)| {
            let week = match after {
                Some(()) => WeekRef::Week(2),
                None => week.unwrap_or(WeekRef::Upcoming),
            };
            Item::Day(DayRef::Weekday(day, week))
        },
    )
    .parse(i)
}

/// `this morning`, `this evening`: today's, even once it has passed.
fn today_daypart(i: &str) -> Res<'_, Vec<Item>> {
    map(
        (kw("this"), sp, map_opt(word, words::daypart)),
        |(.., part)| vec![Item::Day(DayRef::Relative(0)), Item::Daypart(part)],
    )
    .parse(i)
}

/// `morning`, `in the afternoon`, `noon`, `midnight`.
fn daypart(i: &str) -> Res<'_, Item> {
    map(
        preceded(
            opt(alt((
                recognize((kw("in"), sp, kw("the"), sp)),
                recognize((kw("in"), sp)),
            ))),
            map_opt(word, words::daypart),
        ),
        Item::Daypart,
    )
    .parse(i)
}

fn meridiem(i: &str) -> Res<'_, Meridiem> {
    alt((
        value(Meridiem::Am, kws(&["am", "a"])),
        value(Meridiem::Pm, kws(&["pm", "p"])),
    ))
    .parse(i)
}

/// `3`, `3pm`, `3:30`, `15:30`, `3.30 pm`, `930am`, `3 o'clock`.
fn clock(i: &str) -> Res<'_, Item> {
    alt((
        map(
            (
                verify(digits, |(_, len)| (3..=4).contains(len)),
                opt(sp),
                meridiem,
            ),
            |((time, _), _, meridiem)| {
                Item::Clock(Clock {
                    hour: time / 100,
                    minute: time % 100,
                    meridiem: Some(meridiem),
                    exact: false,
                    bare: false,
                })
            },
        ),
        map(
            (
                small,
                opt(preceded(one_of(":."), verify(digits, |(_, len)| *len == 2))),
                opt(preceded(opt(sp), meridiem)),
                opt(preceded(opt(sp), kw("oclock"))),
                boundary,
            ),
            |((hour, len), minute, meridiem, oclock, ())| {
                Item::Clock(Clock {
                    hour,
                    minute: minute.map_or(0, |(minute, _)| minute),
                    meridiem,
                    exact: meridiem.is_none()
                        && ((len == 2 && hour < 10) || hour == 0 || hour >= 13),
                    bare: minute.is_none() && meridiem.is_none() && oclock.is_none(),
                })
            },
        ),
    ))
    .parse(i)
}

fn separator(i: &str) -> Res<'_, Item> {
    value(
        Item::To,
        alt((
            tag("-"),
            kws(&["to", "until", "till", "til", "through", "thru", "thro"]),
        )),
    )
    .parse(i)
}

fn filler(i: &str) -> Res<'_, Vec<Item>> {
    value(
        vec![],
        alt((any_phrase(&FILLER_PHRASES), kws(FILLER_WORDS))),
    )
    .parse(i)
}
