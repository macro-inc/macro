//! Vocabulary: names of days, months, units and relations, each with the
//! shortest prefix that still reads as it, other abbreviations, and typos;
//! number words and parts of the day.
use chrono::Weekday;

use crate::phrase::Daypart;

#[cfg(test)]
mod test;

/// A typo must still be this long, so a short word never reads as a name.
const MIN_TYPO_WORD: usize = 5;

/// Each entry is the value, its name, the fewest letters of the name that
/// still read as it (`3` reads `mon`, `mond` and `monda` as Monday), and
/// other spellings that aren't prefixes of the name.
type Names<T> = [(T, &'static str, usize, &'static [&'static str])];

const WEEKDAYS: &Names<Weekday> = &[
    (Weekday::Mon, "monday", 3, &[]),
    (Weekday::Tue, "tuesday", 3, &["tu"]),
    (Weekday::Wed, "wednesday", 3, &["weds"]),
    (Weekday::Thu, "thursday", 3, &["thr", "thrs"]),
    (Weekday::Fri, "friday", 3, &[]),
    (Weekday::Sat, "saturday", 3, &[]),
    (Weekday::Sun, "sunday", 3, &[]),
];

const MONTHS: &Names<u32> = &[
    (1, "january", 3, &[]),
    (2, "february", 3, &[]),
    (3, "march", 3, &[]),
    (4, "april", 3, &[]),
    (5, "may", 3, &[]),
    (6, "june", 3, &[]),
    (7, "july", 3, &[]),
    (8, "august", 3, &[]),
    (9, "september", 3, &[]),
    (10, "october", 3, &[]),
    (11, "november", 3, &[]),
    (12, "december", 3, &[]),
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
    (RelativeWord::Today, "today", 3, &["tdy"]),
    // Not `ton`, a word of its own.
    (
        RelativeWord::Tonight,
        "tonight",
        4,
        &["tonite", "2nite", "tnite"],
    ),
    (
        RelativeWord::Tomorrow,
        "tomorrow",
        3,
        &["tmrw", "tmr", "tmw", "tmrow", "2moro", "2morrow", "2morow"],
    ),
    // Not `yes`.
    (
        RelativeWord::Yesterday,
        "yesterday",
        4,
        &["yday", "ystrdy", "ystd"],
    ),
];

/// Words placing a weekday or a period relative to the current one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Relation {
    This,
    /// `upcoming`, `coming`: the next occurrence, as `this` is.
    Coming,
    Next,
    Last,
    /// `following`: next, and before a day counts a quantity from it, as
    /// in `2 days following friday`.
    Following,
    /// `previous`, `past`: last, and before a day counts a quantity back
    /// from it, as in `2 days past friday`.
    Previous,
}

impl Relation {
    /// The way it points: `following` is `next`, `previous` is `last`.
    pub(crate) fn plain(self) -> Self {
        match self {
            Self::Following => Self::Next,
            Self::Previous => Self::Last,
            relation => relation,
        }
    }
}

const RELATIONS: &Names<Relation> = &[
    (Relation::This, "this", 4, &[]),
    (Relation::Coming, "coming", 6, &[]),
    (Relation::Coming, "upcoming", 4, &[]),
    (Relation::Next, "next", 3, &["nxt"]),
    (Relation::Following, "following", 4, &[]),
    (Relation::Last, "last", 4, &[]),
    (Relation::Previous, "past", 4, &[]),
    (Relation::Previous, "previous", 4, &[]),
];

// Parts of the day keep long prefixes, so `after`, `mid` and `even` stay
// words of their own.
const DAYPARTS: &Names<Daypart> = &[
    (Daypart::Morning, "morning", 4, &[]),
    (Daypart::Noon, "noon", 4, &["midday", "lunch", "lunchtime"]),
    (Daypart::Afternoon, "afternoon", 6, &["aft"]),
    (Daypart::Evening, "evening", 5, &["eve"]),
    (Daypart::Night, "night", 5, &["nite"]),
    (Daypart::Midnight, "midnight", 4, &[]),
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

/// A unit, with how many of it the word means: a fortnight is two weeks.
/// Named in the plural, so the singular is a prefix.
const UNITS: &Names<(Unit, u32)> = &[
    ((Unit::Minute, 1), "minutes", 3, &["m", "mins"]),
    ((Unit::Hour, 1), "hours", 1, &["hr", "hrs"]),
    ((Unit::Day, 1), "days", 1, &[]),
    ((Unit::Week, 1), "weeks", 1, &["wk", "wks"]),
    ((Unit::Week, 2), "fortnights", 9, &[]),
    // Not `mon`, which is Monday.
    ((Unit::Month, 1), "months", 4, &["mo", "mos", "mth", "mths"]),
    ((Unit::Year, 1), "years", 1, &["yr", "yrs"]),
];

/// A day name, abbreviation or near-miss.
pub(crate) fn weekday(word: &str) -> Option<Weekday> {
    named(word, WEEKDAYS)
}

/// A day name in the plural, as in "mondays", which describes a repeat.
pub(crate) fn weekday_plural(word: &str) -> bool {
    WEEKDAYS.iter().any(|(_, name, ..)| {
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

/// `this`, `next`, `last` and their kin, however spelled.
pub(crate) fn relation(word: &str) -> Option<Relation> {
    named(word, RELATIONS)
}

/// A part of the day.
pub(crate) fn daypart(word: &str) -> Option<Daypart> {
    named(word, DAYPARTS)
}

/// A unit, with how many of it the word means, however spelled.
pub(crate) fn unit(word: &str) -> Option<(Unit, u32)> {
    named(word, UNITS)
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

/// The value whose name, alias or prefix is `word`, or else the name
/// closest to it within that name's typo allowance. A word that could be two
/// values isn't guessed.
fn named<T: Copy + PartialEq>(word: &str, names: &Names<T>) -> Option<T> {
    if let Some((value, ..)) = names
        .iter()
        .find(|(_, name, _, aliases)| *name == word || aliases.contains(&word))
    {
        return Some(*value);
    }
    let prefixed = names.iter().filter_map(|(value, name, shortest, _)| {
        (word.len() >= *shortest && name.starts_with(word)).then_some(*value)
    });
    if let Some(value) = only(prefixed) {
        return Some(value);
    }
    if word.len() < MIN_TYPO_WORD {
        return None;
    }
    let near: Vec<(usize, T)> = names
        .iter()
        .filter_map(|(value, name, ..)| {
            // A swapped pair of letters counts as one typo.
            let distance = strsim::osa_distance(word, name);
            (distance <= typos_allowed(name)).then_some((distance, *value))
        })
        .collect();
    let closest = near.iter().map(|(distance, _)| *distance).min()?;
    only(
        near.iter()
            .filter(|(distance, _)| *distance == closest)
            .map(|(_, value)| *value),
    )
}

/// The one value `values` holds, however often; none if it holds two.
fn only<T: PartialEq>(mut values: impl Iterator<Item = T>) -> Option<T> {
    let first = values.next()?;
    values.all(|value| value == first).then_some(first)
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
