//! Vocabulary: day and month names with their abbreviations and typos,
//! number words, units and parts of the day.
use chrono::Weekday;

use crate::phrase::Daypart;

#[cfg(test)]
mod test;

/// Names shorter than this get no typo matching: one letter away from
/// "march" or "june" is too often another word.
const MIN_TYPO_NAME: usize = 6;
/// A typo must still be this long, so a short word never reads as a name.
const MIN_TYPO_WORD: usize = 5;

type Names<T> = [(T, &'static str, &'static [&'static str])];

const WEEKDAYS: &Names<Weekday> = &[
    (Weekday::Mon, "monday", &["mon"]),
    (Weekday::Tue, "tuesday", &["tue", "tues", "tu"]),
    (
        Weekday::Wed,
        "wednesday",
        &["wed", "weds", "wensday", "wendsday"],
    ),
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
            "tmrw",
            "tmr",
            "tmw",
            "tmrow",
            "tom",
            "tomo",
            "2moro",
            "2morrow",
            "2morow",
            "tommorow",
            "tommorrow",
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

/// The value whose name or alias is `word`, or else the one name a single
/// typo away from it.
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
    let mut near = names
        .iter()
        .filter(|(_, name, _)| name.len() >= MIN_TYPO_NAME && one_edit(word, name));
    match (near.next(), near.next()) {
        (Some((value, ..)), None) => Some(*value),
        _ => None,
    }
}

/// Whether `word` is `name` with one letter added, dropped, changed, or
/// swapped with its neighbour.
fn one_edit(word: &str, name: &str) -> bool {
    let (word, name) = (word.as_bytes(), name.as_bytes());
    let same = word.iter().zip(name).take_while(|(a, b)| a == b).count();
    let (word, name) = (&word[same..], &name[same..]);
    match word.len().abs_diff(name.len()) {
        0 => {
            word.is_empty()
                || word[1..] == name[1..]
                || (word.len() >= 2
                    && word[0] == name[1]
                    && word[1] == name[0]
                    && word[2..] == name[2..])
        }
        1 if word.len() < name.len() => word == &name[1..],
        1 => &word[1..] == name,
        _ => false,
    }
}
