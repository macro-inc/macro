use super::*;

#[test]
fn weekday_abbreviations_name_their_day() {
    for (words, day) in [
        (&["monday", "mon"][..], Weekday::Mon),
        (&["tuesday", "tue", "tues", "tu"], Weekday::Tue),
        (
            &["wednesday", "wed", "weds", "wensday", "wendsday"],
            Weekday::Wed,
        ),
        (
            &["thursday", "thu", "thur", "thurs", "thr", "thrs"],
            Weekday::Thu,
        ),
        (&["friday", "fri"], Weekday::Fri),
        (&["saturday", "sat"], Weekday::Sat),
        (&["sunday", "sun"], Weekday::Sun),
    ] {
        for word in words {
            assert_eq!(weekday(word), Some(day), "{word}");
        }
    }
}

#[test]
fn one_typo_in_a_long_name_still_reads() {
    for (word, day) in [
        ("thrusday", Weekday::Thu),
        ("thurday", Weekday::Thu),
        ("tuseday", Weekday::Tue),
        ("wednsday", Weekday::Wed),
        ("saterday", Weekday::Sat),
        ("monady", Weekday::Mon),
        ("frday", Weekday::Fri),
        ("fridya", Weekday::Fri),
    ] {
        assert_eq!(weekday(word), Some(day), "{word}");
    }
    for (word, month_number) in [
        ("febuary", 2),
        ("feburary", 2),
        ("janury", 1),
        ("agust", 8),
        ("septmber", 9),
        ("decmber", 12),
    ] {
        assert_eq!(month(word), Some(month_number), "{word}");
    }
    assert_eq!(relative("tomorow"), Some(RelativeWord::Tomorrow));
    assert_eq!(relative("yesterdy"), Some(RelativeWord::Yesterday));
    assert_eq!(daypart("afternon"), Some(Daypart::Afternoon));
}

#[test]
fn short_names_and_ambiguous_typos_are_not_guessed() {
    // One letter from both Sunday and Monday.
    assert_eq!(weekday("munday"), None);
    // March, April, May, June and July are too short to guess at.
    assert_eq!(month("mrach"), None);
    assert_eq!(month("match"), None);
    assert_eq!(month("jule"), None);
    // Two edits away.
    assert_eq!(weekday("thrsdy"), None);
    // Too short to be a typo of anything.
    assert_eq!(weekday("fry"), None);
}

#[test]
fn month_abbreviations_name_their_month() {
    for (word, number) in [
        ("jan", 1),
        ("feb", 2),
        ("mar", 3),
        ("apr", 4),
        ("may", 5),
        ("jun", 6),
        ("jul", 7),
        ("aug", 8),
        ("sep", 9),
        ("sept", 9),
        ("oct", 10),
        ("nov", 11),
        ("dec", 12),
        ("november", 11),
    ] {
        assert_eq!(month(word), Some(number), "{word}");
    }
}

#[test]
fn plural_day_names_mark_a_repeat() {
    assert!(weekday_plural("mondays"));
    assert!(weekday_plural("fridays"));
    assert!(!weekday_plural("monday"));
    assert!(!weekday_plural("mons"));
}

#[test]
fn one_edit_covers_each_kind_of_typo() {
    assert!(one_edit("fridday", "friday"));
    assert!(one_edit("frday", "friday"));
    assert!(one_edit("frixay", "friday"));
    assert!(one_edit("firday", "friday"));
    assert!(!one_edit("fdiray", "friday"));
    assert!(!one_edit("fri", "friday"));
}
