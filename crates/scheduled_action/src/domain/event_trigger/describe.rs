//! A trigger in words, as a routine's card shows it: "Weekdays at 9:00 AM",
//! "New email received". In English, like the rest of a suggestion's card,
//! and worded as the web app's routine editor words it.

use chrono::{DateTime, Datelike, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use chrono_tz::Tz;
use cron::TimeUnitSpec;
use system_properties::SystemPropertyKey;

use super::{ActionTrigger, EventFilter, EventName, RoutineTrigger};
use crate::domain::models::Schedule;

#[cfg(test)]
mod test;

impl ActionTrigger {
    /// Its first trigger in words, without its time zone: a schedule in its
    /// own zone, a one-off time in `zone`. A date shows its year when that
    /// isn't `now`'s.
    pub fn describe(&self, zone: Tz, now: DateTime<Utc>) -> String {
        match self {
            Self::Cron { schedule, timezone } => describe_schedule(schedule, *timezone, now),
            Self::Events { filters } => describe_filters(filters.as_slice()),
            Self::Once { at } => describe_once(*at, zone, now),
            Self::Multiple { triggers } => match triggers.as_slice().first() {
                Some(RoutineTrigger::Cron { schedule, timezone }) => {
                    describe_schedule(schedule, *timezone, now)
                }
                Some(RoutineTrigger::Events { filters }) => describe_filters(filters.as_slice()),
                Some(RoutineTrigger::Once { at }) => describe_once(*at, zone, now),
                None => String::new(),
            },
        }
    }
}

/// A plain hourly, daily, weekly, monthly or one-off schedule in words,
/// else the cron expression itself.
fn describe_schedule(schedule: &Schedule, timezone: Tz, now: DateTime<Utc>) -> String {
    let custom = || format!("Custom schedule ({})", schedule.as_str().trim());
    let cron = schedule.as_cron();
    let (Some(0), Some(minute)) = (single(cron.seconds()), single(cron.minutes())) else {
        return custom();
    };
    let any_day = cron.days_of_month().is_all() && cron.days_of_week().is_all();
    let any_month = cron.months().is_all() && cron.years().is_all();
    if cron.hours().is_all() {
        return match (any_day && any_month, minute) {
            (true, 0) => "Every hour".to_owned(),
            (true, minute) => format!("Every hour at :{minute:02}"),
            (false, _) => custom(),
        };
    }
    let Some(hour) = single(cron.hours()) else {
        return custom();
    };
    let Some(time) = NaiveTime::from_hms_opt(hour, minute, 0) else {
        return custom();
    };
    if !any_month {
        // A date and time, once: a one-off saved as a schedule.
        let this_year = now.with_timezone(&timezone).year();
        return once_date(&cron).map_or_else(custom, |date| {
            describe_moment(NaiveDateTime::new(date, time), this_year)
        });
    }
    let time = time_label(time);
    match (cron.days_of_month().is_all(), cron.days_of_week().is_all()) {
        (true, true) => format!("Every day at {time}"),
        (true, false) => format!("{} at {time}", describe_days(cron.days_of_week())),
        (false, true) => single(cron.days_of_month()).map_or_else(custom, |day| {
            format!("Monthly on the {} at {time}", ordinal(day))
        }),
        (false, false) => custom(),
    }
}

/// The one date a schedule allows, when it names a year, month and day.
fn once_date(cron: &cron::Schedule) -> Option<NaiveDate> {
    if !cron.days_of_week().is_all() {
        return None;
    }
    let year = i32::try_from(single(cron.years())?).ok()?;
    NaiveDate::from_ymd_opt(year, single(cron.months())?, single(cron.days_of_month())?)
}

/// The one value a cron field allows, if it allows only one.
fn single(field: &impl TimeUnitSpec) -> Option<u32> {
    let mut values = field.iter();
    match (values.next(), values.next()) {
        (Some(value), None) => Some(value),
        _ => None,
    }
}

/// "9:00 AM".
fn time_label(time: NaiveTime) -> String {
    time.format("%-I:%M %p").to_string()
}

/// "Oct 31 at 9:00 AM", with ", 2027" after the day in another year.
fn describe_moment(at: NaiveDateTime, this_year: i32) -> String {
    let date = if at.year() == this_year {
        at.format("%b %-d")
    } else {
        at.format("%b %-d, %Y")
    };
    format!("{date} at {}", time_label(at.time()))
}

fn describe_once(at: DateTime<Utc>, zone: Tz, now: DateTime<Utc>) -> String {
    describe_moment(
        at.with_timezone(&zone).naive_local(),
        now.with_timezone(&zone).year(),
    )
}

/// Cron's day numbers (1 is Sunday) in the order a week reads, Monday
/// first, with each day's short and plural names.
const WEEK: [(u32, &str, &str); 7] = [
    (2, "Mon", "Mondays"),
    (3, "Tue", "Tuesdays"),
    (4, "Wed", "Wednesdays"),
    (5, "Thu", "Thursdays"),
    (6, "Fri", "Fridays"),
    (7, "Sat", "Saturdays"),
    (1, "Sun", "Sundays"),
];

/// "Weekdays", "Weekends", "Mondays", "Mon, Wed and Fri".
fn describe_days(field: &impl TimeUnitSpec) -> String {
    let days: Vec<_> = WEEK
        .iter()
        .filter(|(day, ..)| field.includes(*day))
        .collect();
    let numbers: Vec<u32> = days.iter().map(|(day, ..)| *day).collect();
    match (numbers.as_slice(), days.as_slice()) {
        (_, []) => "Weekly".to_owned(),
        (_, [(_, _, plural)]) => (*plural).to_owned(),
        ([2, 3, 4, 5, 6], _) => "Weekdays".to_owned(),
        ([7, 1], _) => "Weekends".to_owned(),
        (_, [rest @ .., (_, last, _)]) if days.len() < WEEK.len() => {
            let rest: Vec<&str> = rest.iter().map(|(_, short, _)| *short).collect();
            format!("{} and {last}", rest.join(", "))
        }
        _ => "Every day".to_owned(),
    }
}

/// "1st", "2nd", "11th", "23rd".
fn ordinal(day: u32) -> String {
    let suffix = match (day % 100, day % 10) {
        (11..=13, _) => "th",
        (_, 1) => "st",
        (_, 2) => "nd",
        (_, 3) => "rd",
        _ => "th",
    };
    format!("{day}{suffix}")
}

/// The first event filter in words: its events, or the GitHub deliveries it
/// takes.
fn describe_filters(filters: &[EventFilter]) -> String {
    let Some(filter) = filters.first() else {
        return String::new();
    };
    if filter.events().contains(&EventName::Github) {
        return describe_github(filter);
    }
    filter
        .events()
        .iter()
        .map(|event| event_label(*event, filter))
        .collect::<Vec<_>>()
        .join(", ")
}

fn event_label(event: EventName, filter: &EventFilter) -> &'static str {
    match event {
        EventName::DocumentCreated => "Document created",
        EventName::DocumentUpdated => "Document details changed",
        EventName::DocumentDeleted => "Document deleted",
        EventName::TaskCreated => "Task created",
        EventName::TaskStatusChanged => "Status changed",
        EventName::TaskPriorityChanged => "Priority changed",
        EventName::TaskPropertyChanged => match filter
            .property()
            .map(|property| SystemPropertyKey::from_uuid(property.definition_id()))
        {
            None => "Any property changed",
            Some(Some(SystemPropertyKey::Assignees)) => "Assignees changed",
            Some(Some(SystemPropertyKey::DueDate)) => "Due date changed",
            Some(Some(SystemPropertyKey::Project)) => "Project changed",
            Some(Some(SystemPropertyKey::Effort)) => "Effort changed",
            Some(_) => "Property changed",
        },
        EventName::EmailMessageReceived => "New email received",
        EventName::ChannelCreated => "Channel created",
        EventName::ChannelMessagePosted => "Message sent in channel",
        EventName::ChannelMentioned => "@ mentioned in channel",
        EventName::ChannelMessagePatched => "Message edited",
        EventName::ChannelMessageAttachmentCreated => "Attachment added",
        EventName::CallStarted => "Call started",
        EventName::CallEnded => "Call ended",
        EventName::Github => "Any GitHub event",
    }
}

/// The GitHub deliveries the app's menu offers, by their events and actions.
const GITHUB_PRESETS: [(&str, &[&str], &[&str]); 8] = [
    ("Pull request opened", &["pull_request"], &["opened"]),
    ("Pull request merged", &["pull_request"], &["closed"]),
    ("Review requested", &["pull_request"], &["review_requested"]),
    ("Review submitted", &["pull_request_review"], &["submitted"]),
    ("Issue opened", &["issues"], &["opened"]),
    ("Comment added", &["issue_comment"], &["created"]),
    ("Code pushed", &["push"], &[]),
    ("Release published", &["release"], &["published"]),
];

/// A delivery the app's menu offers by its name, else the events it takes.
fn describe_github(filter: &EventFilter) -> String {
    let Some(selector) = filter.github() else {
        return "Any GitHub event".to_owned();
    };
    let same = |names: &[String], preset: &[&str]| {
        let mut names: Vec<&str> = names.iter().map(String::as_str).collect();
        let mut preset = preset.to_vec();
        names.sort_unstable();
        names.dedup();
        preset.sort_unstable();
        names == preset
    };
    let (events, actions) = (selector.events(), selector.actions());
    if same(events, &["workflow_run"]) && same(actions, &["completed"]) {
        // The menu's failed workflows test the conclusion; finished ones don't.
        return match filter.payload() {
            Some(_) => "Workflow failed",
            None => "Workflow finished",
        }
        .to_owned();
    }
    if let Some((label, ..)) = GITHUB_PRESETS
        .iter()
        .find(|(_, preset_events, preset_actions)| {
            same(events, preset_events) && same(actions, preset_actions)
        })
    {
        return (*label).to_owned();
    }
    if events.is_empty() {
        return "Any GitHub event".to_owned();
    }
    format!("GitHub {}", events.join(", "))
}
