//! Phrases people write, read at fixed times. Each table lists the phrase and
//! the expected reading: `2026-11-13` is a whole day, `2026-11-13 15:00` a
//! time, `+90m` elapsed time, `a → b` a range, and `[...]` what was assumed.
use chrono::{NaiveDateTime, NaiveTime};

use super::*;

/// Friday, November 6, 2026, 10am.
const FRIDAY: &str = "2026-11-06 10:00";
/// The same Friday at 7pm.
const FRIDAY_EVENING: &str = "2026-11-06 19:00";
const MONDAY: &str = "2026-11-02 10:00";
const SATURDAY: &str = "2026-11-07 10:00";
const SUNDAY: &str = "2026-11-08 10:00";
/// Wednesday, December 30, 2026: weeks and months cross into 2027.
const YEAR_END: &str = "2026-12-30 10:00";
/// Sunday, January 31, 2027: a month later has no 31st.
const MONTH_END: &str = "2027-01-31 10:00";

/// How the app's surfaces read dates.
#[derive(Debug, Clone, Copy)]
enum Caller {
    /// A task's due date: the end of a week or range, a whole day by default.
    TaskDue,
    /// When a reminder shows up: the start, at 9am by default.
    Reminder,
    /// A calendar event: the start and any written end, all-day by default.
    Event,
}

impl Caller {
    fn read(self, phrase: &str, now: NaiveDateTime) -> Result<Reading, Error> {
        let nine = NaiveTime::from_hms_opt(9, 0, 0);
        match self {
            Self::TaskDue => read(phrase, now, Pick::End, None),
            Self::Reminder => read(phrase, now, Pick::Start, nine),
            Self::Event => read(phrase, now, Pick::Span, None),
        }
    }
}

fn moment(moment: Moment) -> String {
    match moment {
        Moment::Day(day) => day.format("%Y-%m-%d").to_string(),
        Moment::At(at) => at.format("%Y-%m-%d %H:%M").to_string(),
        Moment::After(delta) => format!("+{}m", delta.num_minutes()),
    }
}

fn show(result: Result<Reading, Error>) -> String {
    let Reading {
        start,
        end,
        assumed,
    } = match result {
        Ok(reading) => reading,
        Err(error) => return format!("error: {error:?}"),
    };
    let mut text = moment(start);
    if let Some(end) = end {
        text = format!("{text} → {}", moment(end));
    }
    let guessed: Vec<&str> = [
        (assumed.meridiem, "meridiem"),
        (assumed.year, "year"),
        (assumed.time, "time"),
    ]
    .into_iter()
    .filter_map(|(guessed, name)| guessed.then_some(name))
    .collect();
    if !guessed.is_empty() {
        text = format!("{text} [{}]", guessed.join(", "));
    }
    text
}

/// Reads every phrase and reports all mismatches together.
fn check(now: &str, caller: Caller, cases: &[(&str, &str)]) {
    let now = NaiveDateTime::parse_from_str(now, "%Y-%m-%d %H:%M").unwrap();
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|(phrase, want)| {
            let got = show(caller.read(phrase, now));
            (got != *want).then(|| format!("{phrase:?} ({caller:?}): want {want}, got {got}"))
        })
        .collect();
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn days_relative_to_today() {
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("today", "2026-11-06"),
            ("tdy", "2026-11-06"),
            ("tomorrow", "2026-11-07"),
            ("Tomorrow", "2026-11-07"),
            ("tmrw", "2026-11-07"),
            ("tmr", "2026-11-07"),
            ("tom", "2026-11-07"),
            ("2moro", "2026-11-07"),
            ("tomorow", "2026-11-07"),
            ("tommorow", "2026-11-07"),
            ("tommorrow", "2026-11-07"),
            ("tmorow", "2026-11-07"),
            ("yesterday", "2026-11-05"),
            ("yday", "2026-11-05"),
            ("day after tomorrow", "2026-11-08"),
            ("the day after tomorrow", "2026-11-08"),
            ("day before yesterday", "2026-11-04"),
            ("in 3 days", "2026-11-09"),
            ("in 3d", "2026-11-09"),
            ("in a day", "2026-11-07"),
            ("in two days", "2026-11-08"),
            ("in a couple of days", "2026-11-08"),
            ("in a couple days", "2026-11-08"),
            ("3 days from now", "2026-11-09"),
            ("a week from today", "2026-11-13"),
            ("a week from tomorrow", "2026-11-14"),
            ("two weeks from now", "2026-11-20"),
            ("in a week", "2026-11-13"),
            ("in 1 week", "2026-11-13"),
            ("in 2 weeks", "2026-11-20"),
            ("in 2wks", "2026-11-20"),
            ("in a fortnight", "2026-11-20"),
            ("in a month", "2026-12-06"),
            ("in 2 months", "2027-01-06"),
            ("in 2mo", "2027-01-06"),
            ("in a year", "2027-11-06"),
            ("3 days ago", "2026-11-03"),
            ("2 weeks ago", "2026-10-23"),
            ("a month ago", "2026-10-06"),
        ],
    );
}

#[test]
fn weekdays_and_their_abbreviations() {
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("friday", "2026-11-06"),
            ("fri", "2026-11-06"),
            ("Fri.", "2026-11-06"),
            ("FRIDAY", "2026-11-06"),
            ("this friday", "2026-11-06"),
            ("coming friday", "2026-11-06"),
            ("this coming friday", "2026-11-06"),
            ("next friday", "2026-11-13"),
            ("next fri", "2026-11-13"),
            ("nxt fri", "2026-11-13"),
            ("last friday", "2026-10-30"),
            ("this past friday", "2026-10-30"),
            ("friday after next", "2026-11-20"),
            ("the friday after next", "2026-11-20"),
            ("friday next week", "2026-11-13"),
            ("next week friday", "2026-11-13"),
            ("next week on friday", "2026-11-13"),
            ("friday of next week", "2026-11-13"),
            ("friday this week", "2026-11-06"),
            ("monday", "2026-11-09"),
            ("mon", "2026-11-09"),
            ("this monday", "2026-11-09"),
            ("next monday", "2026-11-09"),
            ("last monday", "2026-11-02"),
            ("monady", "2026-11-09"),
            ("tuesday", "2026-11-10"),
            ("tue", "2026-11-10"),
            ("tues", "2026-11-10"),
            ("tu", "2026-11-10"),
            ("tuseday", "2026-11-10"),
            ("wednesday", "2026-11-11"),
            ("wed", "2026-11-11"),
            ("weds", "2026-11-11"),
            ("wensday", "2026-11-11"),
            ("wendsday", "2026-11-11"),
            ("wednsday", "2026-11-11"),
            ("thursday", "2026-11-12"),
            ("thu", "2026-11-12"),
            ("thur", "2026-11-12"),
            ("thurs", "2026-11-12"),
            ("thrusday", "2026-11-12"),
            ("thurday", "2026-11-12"),
            ("next thrsdy", "2026-11-12"),
            ("wednsdy", "2026-11-11"),
            // One typo from both Tuesday and Thursday.
            ("tursday", "error: Unrecognized"),
            ("saturday", "2026-11-07"),
            ("sat", "2026-11-07"),
            ("saterday", "2026-11-07"),
            ("sunday", "2026-11-08"),
            ("sun", "2026-11-08"),
        ],
    );
}

#[test]
fn weekdays_from_other_days_of_the_week() {
    check(
        MONDAY,
        Caller::TaskDue,
        &[
            ("friday", "2026-11-06"),
            ("this friday", "2026-11-06"),
            ("next friday", "2026-11-13"),
            ("monday", "2026-11-02"),
            ("next monday", "2026-11-09"),
            ("last friday", "2026-10-30"),
            ("sunday", "2026-11-08"),
            ("this week", "2026-11-06"),
            ("next week", "2026-11-13"),
            ("end of week", "2026-11-06"),
        ],
    );
    check(
        SATURDAY,
        Caller::TaskDue,
        &[
            ("friday", "2026-11-13"),
            ("next friday", "2026-11-13"),
            ("last friday", "2026-11-06"),
            ("sunday", "2026-11-08"),
            ("next sunday", "2026-11-15"),
            // Friday has passed, so the week is due on its Sunday.
            ("this week", "2026-11-08"),
            ("end of week", "2026-11-08"),
            ("next week", "2026-11-13"),
            ("this weekend", "2026-11-08"),
        ],
    );
    check(
        SUNDAY,
        Caller::TaskDue,
        &[
            ("monday", "2026-11-09"),
            ("next monday", "2026-11-09"),
            ("next week", "2026-11-13"),
            ("this weekend", "2026-11-08"),
            ("next weekend", "2026-11-15"),
        ],
    );
}

#[test]
fn written_dates() {
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("nov 12", "2026-11-12"),
            ("november 12", "2026-11-12"),
            ("november 12th", "2026-11-12"),
            ("Nov. 12th", "2026-11-12"),
            ("12 nov", "2026-11-12"),
            ("12th nov", "2026-11-12"),
            ("12th of november", "2026-11-12"),
            ("the 12th of november", "2026-11-12"),
            ("nov 12 2027", "2027-11-12"),
            ("november 12, 2027", "2027-11-12"),
            ("11/12", "2026-11-12"),
            ("11/12/2026", "2026-11-12"),
            ("11/12/27", "2027-11-12"),
            ("2026-11-12", "2026-11-12"),
            ("2026/11/12", "2026-11-12"),
            ("dec 1st", "2026-12-01"),
            ("december 1", "2026-12-01"),
            ("first of december", "2026-12-01"),
            ("sept 3", "2027-09-03 [year]"),
            ("jan 5", "2027-01-05 [year]"),
            ("1/5", "2027-01-05 [year]"),
            ("febuary 3", "2027-02-03 [year]"),
            ("febuwary 3", "2027-02-03 [year]"),
            ("feb 29", "2028-02-29 [year]"),
            // Passed within the last month: this year's, so it shows as overdue.
            ("nov 5", "2026-11-05 [year]"),
            ("oct 10", "2026-10-10 [year]"),
            // Passed longer ago: next year's.
            ("oct 1", "2027-10-01 [year]"),
            ("the 12th", "2026-11-12"),
            ("12th", "2026-11-12"),
            ("the 6th", "2026-11-06"),
            ("the 5th", "2026-12-05"),
            ("the 31st", "2026-12-31"),
            ("on the first", "2026-12-01"),
            ("fri nov 13", "2026-11-13"),
            ("friday november 13th", "2026-11-13"),
            ("Friday, November 13th, 2026", "2026-11-13"),
            ("friday the 13th", "2026-11-13"),
            ("feb 30", "error: InvalidDate"),
            ("13/1", "error: Unrecognized"),
            ("thu nov 13", "error: WeekdayMismatch"),
            ("tomorrow friday", "error: WeekdayMismatch"),
        ],
    );
}

#[test]
fn a_due_date_takes_the_end_of_a_week_or_month() {
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("next week", "2026-11-13"),
            ("due next week", "2026-11-13"),
            ("sometime next week", "2026-11-13"),
            ("this week", "2026-11-06"),
            ("end of week", "2026-11-06"),
            ("end of the week", "2026-11-06"),
            ("end-of-week", "2026-11-06"),
            ("eow", "2026-11-06"),
            ("end of next week", "2026-11-13"),
            ("by the end of next week", "2026-11-13"),
            ("week after next", "2026-11-20"),
            ("the week after next", "2026-11-20"),
            ("last week", "2026-10-30"),
            ("start of next week", "2026-11-09"),
            ("beginning of next week", "2026-11-09"),
            ("this weekend", "2026-11-08"),
            ("weekend", "2026-11-08"),
            ("the weekend", "2026-11-08"),
            ("next weekend", "2026-11-15"),
            ("this month", "2026-11-30"),
            ("next month", "2026-12-31"),
            ("end of month", "2026-11-30"),
            ("end of the month", "2026-11-30"),
            ("eom", "2026-11-30"),
            ("end of next month", "2026-12-31"),
            ("start of next month", "2026-12-01"),
            ("november", "2026-11-30"),
            ("december", "2026-12-31"),
            ("in december", "2026-12-31"),
            ("january", "2027-01-31 [year]"),
            ("this year", "2026-12-31"),
            ("next year", "2027-12-31"),
            ("end of year", "2026-12-31"),
            ("eoy", "2026-12-31"),
        ],
    );
}

#[test]
fn reminders_and_events_take_the_start_of_a_week_or_month() {
    check(
        FRIDAY,
        Caller::Reminder,
        &[
            ("next week", "2026-11-09 09:00 [time]"),
            ("next week at 3pm", "2026-11-09 15:00"),
            ("this weekend", "2026-11-07 09:00 [time]"),
            ("next month", "2026-12-01 09:00 [time]"),
            ("december", "2026-12-01 09:00 [time]"),
            ("end of month", "2026-11-30 09:00 [time]"),
        ],
    );
    check(
        FRIDAY,
        Caller::Event,
        &[
            ("next week", "2026-11-09"),
            ("this weekend", "2026-11-07"),
            ("next month", "2026-12-01"),
            // Already begun: from today.
            ("this week", "2026-11-06"),
            ("this month", "2026-11-06"),
            ("november", "2026-11-06"),
        ],
    );
}

#[test]
fn times_of_day() {
    check(
        FRIDAY,
        Caller::Event,
        &[
            ("tomorrow at 3pm", "2026-11-07 15:00"),
            ("tomorrow 3pm", "2026-11-07 15:00"),
            ("3pm tomorrow", "2026-11-07 15:00"),
            ("tomorrow @ 3pm", "2026-11-07 15:00"),
            ("tomorrow at 3 p.m.", "2026-11-07 15:00"),
            ("tomorrow 3 PM", "2026-11-07 15:00"),
            ("tomorrow at 15:00", "2026-11-07 15:00"),
            ("tomorrow 3:30pm", "2026-11-07 15:30"),
            ("tomorrow 3.30pm", "2026-11-07 15:30"),
            ("tomorrow 330pm", "2026-11-07 15:30"),
            ("tomorrow at 9:45am", "2026-11-07 09:45"),
            ("tomorrow at 09:30", "2026-11-07 09:30"),
            ("tomorrow at 3am", "2026-11-07 03:00"),
            ("tomorrow 8a", "2026-11-07 08:00"),
            ("tomorrow 5p", "2026-11-07 17:00"),
            ("tomorrow at 3", "2026-11-07 15:00 [meridiem]"),
            ("tomorrow at 7", "2026-11-07 19:00 [meridiem]"),
            ("tomorrow at 8", "2026-11-07 08:00 [meridiem]"),
            ("tomorrow at 12", "2026-11-07 12:00 [meridiem]"),
            ("tomorrow at 3 o'clock", "2026-11-07 15:00 [meridiem]"),
            ("noon tomorrow", "2026-11-07 12:00"),
            ("tomorrow at noon", "2026-11-07 12:00"),
            ("tomorrow at 12 noon", "2026-11-07 12:00"),
            ("lunch tomorrow", "2026-11-07 12:00"),
            ("tomorrow at midnight", "2026-11-08 00:00"),
            ("midnight", "2026-11-07 00:00"),
            ("tomorrow morning", "2026-11-07 09:00"),
            ("tomorrow afternoon", "2026-11-07 13:00"),
            ("tomorrow evening", "2026-11-07 18:00"),
            ("tomorrow night", "2026-11-07 20:00"),
            ("tomorrow morning at 8", "2026-11-07 08:00"),
            ("8 in the morning tomorrow", "2026-11-07 08:00"),
            ("tomorrow at 3 in the afternoon", "2026-11-07 15:00"),
            ("tonight", "2026-11-06 20:00"),
            ("tonite", "2026-11-06 20:00"),
            ("tonight at 8", "2026-11-06 20:00"),
            ("tonight at 11", "2026-11-06 23:00"),
            ("tonight at 1", "2026-11-07 01:00"),
            ("this morning", "2026-11-06 09:00"),
            ("this afternoon", "2026-11-06 13:00"),
            ("this evening", "2026-11-06 18:00"),
            ("later today", "2026-11-06 17:00"),
            ("eod", "2026-11-06 17:00"),
            ("end of day", "2026-11-06 17:00"),
            ("cob", "2026-11-06 17:00"),
            ("EOD friday", "2026-11-06 17:00"),
            ("by eod friday", "2026-11-06 17:00"),
            ("close of business tomorrow", "2026-11-07 17:00"),
            ("friday at 5pm", "2026-11-06 17:00"),
            // 9am today has passed, so a bare weekday moves to next week.
            ("friday at 9am", "2026-11-13 09:00"),
            ("nov 12 at 2pm", "2026-11-12 14:00"),
            ("11/12 9am", "2026-11-12 09:00"),
            ("3pm", "2026-11-06 15:00"),
            ("12pm", "2026-11-06 12:00"),
            ("at 3", "2026-11-06 15:00 [meridiem]"),
            // Times alone that have passed today move to tomorrow.
            ("9am", "2026-11-07 09:00"),
            ("12am", "2026-11-07 00:00"),
            ("13pm", "error: InvalidTime"),
            ("25:00", "error: InvalidTime"),
            ("3:75pm", "error: InvalidTime"),
        ],
    );
    check(
        FRIDAY_EVENING,
        Caller::Event,
        &[
            ("tonight", "2026-11-06 20:00"),
            ("8pm", "2026-11-06 20:00"),
            ("at 7", "2026-11-06 19:00 [meridiem]"),
            ("at 6", "2026-11-07 18:00 [meridiem]"),
            ("this evening", "2026-11-06 18:00"),
        ],
    );
}

#[test]
fn event_ranges_and_lengths() {
    check(
        FRIDAY,
        Caller::Event,
        &[
            ("tomorrow 2-3pm", "2026-11-07 14:00 → 2026-11-07 15:00"),
            ("tomorrow 2 - 3pm", "2026-11-07 14:00 → 2026-11-07 15:00"),
            ("tomorrow 2pm–3pm", "2026-11-07 14:00 → 2026-11-07 15:00"),
            (
                "tomorrow from 2 to 3pm",
                "2026-11-07 14:00 → 2026-11-07 15:00",
            ),
            ("2-3pm tomorrow", "2026-11-07 14:00 → 2026-11-07 15:00"),
            (
                "from 2pm to 3pm tomorrow",
                "2026-11-07 14:00 → 2026-11-07 15:00",
            ),
            (
                "tomorrow 3pm until 5pm",
                "2026-11-07 15:00 → 2026-11-07 17:00",
            ),
            ("tomorrow 11-1pm", "2026-11-07 11:00 → 2026-11-07 13:00"),
            ("tomorrow 10am-2", "2026-11-07 10:00 → 2026-11-07 14:00"),
            ("tomorrow noon-2", "2026-11-07 12:00 → 2026-11-07 14:00"),
            (
                "tomorrow 9-5",
                "2026-11-07 09:00 → 2026-11-07 17:00 [meridiem]",
            ),
            (
                "tomorrow 2-3",
                "2026-11-07 14:00 → 2026-11-07 15:00 [meridiem]",
            ),
            ("friday 10pm-1am", "2026-11-06 22:00 → 2026-11-07 01:00"),
            ("2-3pm", "2026-11-06 14:00 → 2026-11-06 15:00"),
            (
                "tomorrow 3pm for 45 minutes",
                "2026-11-07 15:00 → 2026-11-07 15:45",
            ),
            (
                "tomorrow at 3pm for an hour",
                "2026-11-07 15:00 → 2026-11-07 16:00",
            ),
            (
                "tomorrow 3pm for 1.5 hours",
                "2026-11-07 15:00 → 2026-11-07 16:30",
            ),
            (
                "tomorrow 3pm for an hour and a half",
                "2026-11-07 15:00 → 2026-11-07 16:30",
            ),
            (
                "tomorrow 3pm for half an hour",
                "2026-11-07 15:00 → 2026-11-07 15:30",
            ),
            (
                "tomorrow 3pm for 1h30m",
                "2026-11-07 15:00 → 2026-11-07 16:30",
            ),
            (
                "tomorrow 3pm for 90 min",
                "2026-11-07 15:00 → 2026-11-07 16:30",
            ),
            (
                "tomorrow 3pm for 2 hrs",
                "2026-11-07 15:00 → 2026-11-07 17:00",
            ),
            (
                "tomorrow 3pm for 1 hour and 30 minutes",
                "2026-11-07 15:00 → 2026-11-07 16:30",
            ),
            ("nov 12-14", "2026-11-12 → 2026-11-14"),
            ("nov 12 - 14", "2026-11-12 → 2026-11-14"),
            ("nov 12 to nov 14", "2026-11-12 → 2026-11-14"),
            ("12-14 nov", "2026-11-12 → 2026-11-14"),
            ("nov 12th-14th", "2026-11-12 → 2026-11-14"),
            ("nov 12 - dec 2", "2026-11-12 → 2026-12-02"),
            ("dec 28 - jan 3", "2026-12-28 → 2027-01-03 [year]"),
            ("mon-wed", "2026-11-09 → 2026-11-11"),
            ("monday to wednesday", "2026-11-09 → 2026-11-11"),
            ("from monday to wednesday", "2026-11-09 → 2026-11-11"),
            ("monday through wednesday", "2026-11-09 → 2026-11-11"),
            ("mon thru wed", "2026-11-09 → 2026-11-11"),
            ("fri-mon", "2026-11-06 → 2026-11-09"),
            (
                "friday 3pm to sunday 11am",
                "2026-11-06 15:00 → 2026-11-08 11:00",
            ),
            ("friday until 5pm", "2026-11-06 → 2026-11-06 17:00"),
            ("tomorrow for 3 days", "2026-11-07 → 2026-11-09"),
            ("in 2 hours for 30 minutes", "+120m → +150m"),
            ("nov 14 2026 - nov 12 2026", "error: EndBeforeStart"),
            ("tomorrow for 2 hours", "error: DurationWithoutTime"),
        ],
    );
}

#[test]
fn due_dates_and_reminders_take_one_end_of_a_range() {
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("nov 12-14", "2026-11-14"),
            ("mon-wed", "2026-11-11"),
            ("tomorrow 2-3pm", "2026-11-07 15:00"),
            ("friday until 5pm", "2026-11-06 17:00"),
        ],
    );
    check(
        FRIDAY,
        Caller::Reminder,
        &[
            ("tomorrow 2-3pm", "2026-11-07 14:00"),
            ("nov 12-14", "2026-11-12 09:00 [time]"),
        ],
    );
}

#[test]
fn reminders_default_to_nine_and_count_elapsed_time() {
    check(
        FRIDAY,
        Caller::Reminder,
        &[
            ("tomorrow", "2026-11-07 09:00 [time]"),
            ("monday", "2026-11-09 09:00 [time]"),
            // 9am today has passed.
            ("friday", "2026-11-13 09:00 [time]"),
            ("in 3 days", "2026-11-09 09:00 [time]"),
            ("nov 12", "2026-11-12 09:00 [time]"),
            ("tomorrow morning", "2026-11-07 09:00"),
            ("tomorrow at 2", "2026-11-07 14:00 [meridiem]"),
            ("in 30 minutes", "+30m"),
            ("in 30 min", "+30m"),
            ("in 30 mins", "+30m"),
            ("in 30m", "+30m"),
            ("in half an hour", "+30m"),
            ("in an hour", "+60m"),
            ("in 1h", "+60m"),
            ("in 2 hours", "+120m"),
            ("in 2hrs", "+120m"),
            ("in 1.5 hours", "+90m"),
            ("in an hour and a half", "+90m"),
            ("in 1 hour 30 minutes", "+90m"),
            ("in 1h30m", "+90m"),
            ("in 90 minutes", "+90m"),
            ("in 24 hours", "+1440m"),
            ("2 hours from now", "+120m"),
            ("in a couple of hours", "+120m"),
            ("now", "+0m"),
        ],
    );
}

#[test]
fn dates_as_people_write_them_in_messages() {
    check(
        FRIDAY,
        Caller::Event,
        &[
            ("Thu, Nov 12 at 3:30 PM", "2026-11-12 15:30"),
            ("3:30 PM Thursday", "2026-11-12 15:30"),
            ("Thursday @ 3:30pm", "2026-11-12 15:30"),
            ("Thurs 9am", "2026-11-12 09:00"),
            ("this Thurs", "2026-11-12"),
            ("Wed 11/11", "2026-11-11"),
            ("Tues. at 10", "2026-11-10 10:00 [meridiem]"),
            ("next Tues at 10am", "2026-11-10 10:00"),
            ("Sept. 3rd", "2027-09-03 [year]"),
            ("1/1/2027", "2027-01-01"),
            ("the 15th at noon", "2026-11-15 12:00"),
            ("monday morning", "2026-11-09 09:00"),
            ("monday night", "2026-11-09 20:00"),
            ("Friday EOD", "2026-11-06 17:00"),
            ("9am - 5pm monday", "2026-11-09 09:00 → 2026-11-09 17:00"),
            ("monday 9:30-10:15am", "2026-11-09 09:30 → 2026-11-09 10:15"),
            (
                "monday from 9 till 5",
                "2026-11-09 09:00 → 2026-11-09 17:00 [meridiem]",
            ),
            (
                "monday 1:00pm to 2:30pm",
                "2026-11-09 13:00 → 2026-11-09 14:30",
            ),
            ("Dec 24th - Jan 2nd", "2026-12-24 → 2027-01-02 [year]"),
        ],
    );
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("due 11/20", "2026-11-20"),
            ("due by EOW", "2026-11-06"),
            ("by end of day tomorrow", "2026-11-07 17:00"),
            ("by Nov 20th", "2026-11-20"),
            ("no later than Dec 1", "2026-12-01"),
            ("before the 15th", "2026-11-15"),
            ("next Thurs", "2026-11-12"),
            ("within 2 weeks", "2026-11-20"),
        ],
    );
    check(
        FRIDAY,
        Caller::Reminder,
        &[
            ("tmrw 9a", "2026-11-07 09:00"),
            ("mon 8am", "2026-11-09 08:00"),
            ("in 45 min", "+45m"),
            ("tonight", "2026-11-06 20:00"),
            ("later today", "2026-11-06 17:00"),
        ],
    );
}

#[test]
fn filler_and_punctuation_are_ignored() {
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("due next friday", "2026-11-13"),
            ("by friday", "2026-11-06"),
            ("before friday", "2026-11-06"),
            ("on friday", "2026-11-06"),
            ("for friday", "2026-11-06"),
            ("until friday", "2026-11-06"),
            ("no later than friday", "2026-11-06"),
            ("friday at the latest", "2026-11-06"),
            ("on the 12th", "2026-11-12"),
            ("due: friday", "2026-11-06"),
            ("  Next   Friday!!  ", "2026-11-13"),
            ("(next friday)", "2026-11-13"),
            ("around 3pm tomorrow", "2026-11-07 15:00"),
        ],
    );
}

#[test]
fn phrases_it_does_not_read() {
    check(
        FRIDAY,
        Caller::TaskDue,
        &[
            ("", "error: Unrecognized"),
            ("someday", "error: Unrecognized"),
            ("soon", "error: Unrecognized"),
            ("next", "error: Unrecognized"),
            ("in a few days", "error: Unrecognized"),
            ("for 2 hours", "error: Unrecognized"),
            ("every friday", "error: Repeating"),
            ("every other tuesday", "error: Repeating"),
            ("daily", "error: Repeating"),
            ("mondays", "error: Repeating"),
            ("weekdays at 9", "error: Repeating"),
            ("tomorrow yesterday", "error: Conflict"),
            ("3pm 4pm", "error: Conflict"),
            ("next month friday", "error: Conflict"),
        ],
    );
}

#[test]
fn weeks_and_months_across_the_new_year() {
    check(
        YEAR_END,
        Caller::TaskDue,
        &[
            ("tomorrow", "2026-12-31"),
            ("in 2 days", "2027-01-01"),
            ("friday", "2027-01-01"),
            ("next week", "2027-01-08"),
            ("this weekend", "2027-01-03"),
            ("next month", "2027-01-31"),
            ("next year", "2027-12-31"),
            ("the 2nd", "2027-01-02"),
            ("jan 5", "2027-01-05 [year]"),
            ("dec 1", "2026-12-01 [year]"),
            ("nov 15", "2027-11-15 [year]"),
        ],
    );
    check(
        MONTH_END,
        Caller::TaskDue,
        &[
            ("in a month", "2027-02-28"),
            ("next month", "2027-02-28"),
            ("end of month", "2027-01-31"),
            ("feb 1", "2027-02-01"),
        ],
    );
}

#[test]
fn a_default_time_applies_to_any_pick() {
    let now = NaiveDateTime::parse_from_str(FRIDAY, "%Y-%m-%d %H:%M").unwrap();
    let five = NaiveTime::from_hms_opt(17, 0, 0);
    for (pick, default, want) in [
        (Pick::Start, None, "2026-11-09"),
        (Pick::Start, five, "2026-11-09 17:00 [time]"),
        (Pick::End, five, "2026-11-13 17:00 [time]"),
        (Pick::Span, five, "2026-11-09 17:00 [time]"),
    ] {
        assert_eq!(
            show(read("next week", now, pick, default)),
            want,
            "{pick:?}"
        );
    }
    // A written time wins over the default.
    assert_eq!(
        show(read("next week at 3pm", now, Pick::End, five)),
        "2026-11-13 15:00"
    );
}
