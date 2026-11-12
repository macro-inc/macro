//! Vocabulary: day and month names with their abbreviations and typos,
//! number words, units and parts of the day.
use chrono::Weekday;

use crate::phrase::Daypart;

#[cfg(test)]
mod test;

/// A typo must still be this long, so a short word never reads as a name.
const MIN_TYPO_WORD: usize = 5;

type Names<T> = [(T, &'static str, &'static [&'static str])];

const WEEKDAYS: &Names<Weekday> = &[
    (Weekday::Mon, "monday", &["mon"]),
    (Weekday::Tue, "tuesday", &["tue", "tues", "tu"]),
    (Weekday::Wed, "wednesday", &["wed", "weds"]),
    (
        Weekday::Thu,
        "thursday",
        &["thu", "thur", "thurs", "thr", "thrs"],
    ),
    (Weekday::Fri, "friday", &["fri"]),
    (Weekday::Sat, "saturday", &["sat"]),
    (Weekday::Sun, "sunday", &["sun"]),
];

const MONTHS: &Names<u32> = &[
    (1, "january", &["jan"]),
    (2, "february", &["feb", "febr"]),
    (3, "march", &["mar"]),
    (4, "april", &["apr"]),
    (5, "may", &[]),
    (6, "june", &["jun"]),
    (7, "july", &["jul"]),
    (8, "august", &["aug"]),
    (9, "september", &["sep", "sept"]),
    (10, "october", &["oct"]),
    (11, "november", &["nov"]),
    (12, "december", &["dec"]),
];

/// Words naming a day relative to today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RelativeWord {
    Today,
    Tonight,
    Tomorrow,
    Yesterday,
}

const RELATIVE: &Names<RelativeWord> = &[
    (RelativeWord::Today, "today", &["tdy", "tod"]),
    (
        RelativeWord::Tonight,
        "tonight",
        &["tonite", "2nite", "tnite"],
    ),
    (
        RelativeWord::Tomorrow,
        "tomorrow",
        &[
            "tmrw", "tmr", "tmw", "tmrow", "tom", "tomo", "2moro", "2morrow", "2morow",
        ],
    ),
    (
        RelativeWord::Yesterday,
        "yesterday",
        &["yest", "yday", "ystrdy", "ystd"],
    ),
];

const DAYPARTS: &Names<Daypart> = &[
    (Daypart::Morning, "morning", &["mornin", "morn"]),
    (Daypart::Noon, "noon", &["midday", "lunch", "lunchtime"]),
    (Daypart::Afternoon, "afternoon", &["aft"]),
    (Daypart::Evening, "evening", &["eve", "evenin"]),
    (Daypart::Night, "night", &["nite"]),
    (Daypart::Midnight, "midnight", &[]),
];

/// Units of time a quantity can count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unit {
    Minute,
    Hour,
    Day,
    Week,
    Month,
    Year,
}

/// A day name, abbreviation or near-miss.
pub(crate) fn weekday(word: &str) -> Option<Weekday> {
    named(word, WEEKDAYS)
}

/// A day name in the plural, as in "mondays", which describes a repeat.
pub(crate) fn weekday_plural(word: &str) -> bool {
    WEEKDAYS.iter().any(|(_, name, _)| {
        word.len() == name.len() + 1 && word.starts_with(name) && word.ends_with('s')
    })
}

/// A month's number from its name, abbreviation or near-miss.
pub(crate) fn month(word: &str) -> Option<u32> {
    named(word, MONTHS)
}

/// Today, tonight, tomorrow or yesterday, however spelled.
pub(crate) fn relative(word: &str) -> Option<RelativeWord> {
    named(word, RELATIVE)
}

/// A part of the day.
pub(crate) fn daypart(word: &str) -> Option<Daypart> {
    named(word, DAYPARTS)
}

/// A number written as a word: "a week", "two days", "a couple".
pub(crate) fn count(word: &str) -> Option<u32> {
    Some(match word {
        "a" | "an" | "one" => 1,
        "two" | "couple" => 2,
        "three" => 3,
        "four" => 4,
        "five" => 5,
        "six" => 6,
        "seven" => 7,
        "eight" => 8,
        "nine" => 9,
        "ten" => 10,
        "eleven" => 11,
        "twelve" => 12,
        "fifteen" => 15,
        "twenty" => 20,
        "thirty" => 30,
        "forty" => 40,
        "sixty" => 60,
        "ninety" => 90,
        _ => return None,
    })
}

/// A day of the month written as a word: "the first".
pub(crate) fn ordinal(word: &str) -> Option<u32> {
    const ORDINALS: [&str; 20] = [
        "first",
        "second",
        "third",
        "fourth",
        "fifth",
        "sixth",
        "seventh",
        "eighth",
        "ninth",
        "tenth",
        "eleventh",
        "twelfth",
        "thirteenth",
        "fourteenth",
        "fifteenth",
        "sixteenth",
        "seventeenth",
        "eighteenth",
        "nineteenth",
        "twentieth",
    ];
    if word == "thirtieth" {
        return Some(30);
    }
    ORDINALS
        .iter()
        .zip(1..)
        .find_map(|(name, day)| (*name == word).then_some(day))
}

/// A unit, with how many of it the word means: a fortnight is two weeks.
pub(crate) fn unit(word: &str) -> Option<(Unit, u32)> {
    Some(match word {
        "m" | "min" | "mins" | "minute" | "minutes" => (Unit::Minute, 1),
        "h" | "hr" | "hrs" | "hour" | "hours" => (Unit::Hour, 1),
        "d" | "day" | "days" => (Unit::Day, 1),
        "w" | "wk" | "wks" | "week" | "weeks" => (Unit::Week, 1),
        "fortnight" | "fortnights" => (Unit::Week, 2),
        "mo" | "mos" | "mth" | "mths" | "month" | "months" => (Unit::Month, 1),
        "y" | "yr" | "yrs" | "year" | "years" => (Unit::Year, 1),
        _ => return None,
    })
}

/// The value whose name or alias is `word`, or else the name closest to it
/// within that name's typo allowance. A tie for closest isn't guessed.
fn named<T: Copy>(word: &str, names: &Names<T>) -> Option<T> {
    if let Some((value, ..)) = names
        .iter()
        .find(|(_, name, aliases)| *name == word || aliases.contains(&word))
    {
        return Some(*value);
    }
    if word.len() < MIN_TYPO_WORD {
        return None;
    }
    let near: Vec<(usize, T)> = names
        .iter()
        .filter_map(|(value, name, _)| {
            // A swapped pair of letters counts as one typo.
            let distance = strsim::osa_distance(word, name);
            (distance <= typos_allowed(name)).then_some((distance, *value))
        })
        .collect();
    let closest = near.iter().map(|(distance, _)| *distance).min()?;
    let mut closest = near.iter().filter(|(distance, _)| *distance == closest);
    match (closest.next(), closest.next()) {
        (Some((_, value)), None) => Some(*value),
        _ => None,
    }
}

/// How many typos a name tolerates. Names under six letters get none: a
/// letter away from "march" or "june" is too often another word. Names of
/// eight letters or more are long enough for two.
fn typos_allowed(name: &str) -> usize {
    match name.len() {
        ..=5 => 0,
        6 | 7 => 1,
        _ => 2,
    }
}
