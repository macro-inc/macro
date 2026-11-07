//! Structured source facts; calendar arithmetic belongs to the resolver.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A calendar date expression, never a model-computed final date.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DateExpression {
    /// An explicit month/day, with a year only when written.
    Absolute {
        /// Exact source phrase, including its scheduling connector when present.
        span: String,
        /// Written year; null means the next valid occurrence of this month/day.
        year: Option<i32>,
        /// One-based written calendar month.
        month: u32,
        /// Written day of month; invalid dates are rejected by Rust.
        day: u32,
    },
    /// Calendar days relative to the reference date, not elapsed hours.
    RelativeDay {
        /// Exact source phrase, such as tomorrow or in two days.
        span: String,
        /// Today is zero, tomorrow one, yesterday minus one.
        offset_days: i32,
    },
    /// A named weekday with its explicit week relationship.
    Weekday {
        /// Exact source phrase, such as by next Friday.
        span: String,
        /// The weekday named in the source.
        weekday: Weekday,
        /// Bare weekday means upcoming; next means the following Monday–Sunday.
        week: WeekRelation,
    },
}

/// Calendar weekday, resolved independently of provider spelling.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Weekday {
    /// Monday.
    Monday,
    /// Tuesday.
    Tuesday,
    /// Wednesday.
    Wednesday,
    /// Thursday.
    Thursday,
    /// Friday.
    Friday,
    /// Saturday.
    Saturday,
    /// Sunday.
    Sunday,
}

/// Relationship of a weekday to the reference calendar week.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum WeekRelation {
    /// The current Monday–Sunday, even when the named day has passed.
    This,
    /// The following Monday–Sunday.
    Next,
    /// The next occurrence; an already-past clock on today rolls one week.
    Upcoming,
}

/// An explicitly written meridiem marker, including dotted source forms.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Meridiem {
    /// Before noon.
    Am,
    /// Noon or later.
    Pm,
}

/// An explicit daypart associated with the scheduling clock.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Daypart {
    /// Morning.
    Morning,
    /// Afternoon.
    Afternoon,
    /// Evening.
    Evening,
    /// Night.
    Night,
    /// Exactly noon.
    Noon,
    /// Exactly midnight.
    Midnight,
}

/// A written clock before application-owned AM/PM defaults.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ClockExpression {
    /// Exact clock text, without a leading connector; preserve leading zeroes.
    pub span: String,
    /// Raw written hour, not converted to twenty-four-hour time; midnight is zero.
    pub hour: u32,
    /// Written minute, or zero when minutes were omitted.
    pub minute: u32,
    /// Explicit AM/PM only; dotted a.m. and p.m. count as explicit.
    pub meridiem: Option<Meridiem>,
    /// Explicit morning/afternoon/etc.; null when not written.
    pub daypart: Option<Daypart>,
}

/// A local calendar expression or an elapsed offset, never both.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StartExpression {
    /// Date and clock facts; retain missing components as null instead of inventing them.
    Local {
        /// The scheduling date, excluding discussion topics and negated dates.
        date: Option<DateExpression>,
        /// The scheduling clock, excluding quantities such as thirty minutes from now.
        clock: Option<ClockExpression>,
    },
    /// An explicitly supplied elapsed offset from the reference instant.
    Relative {
        /// Exact offset phrase, such as in thirty minutes.
        span: String,
        /// Explicit offset quantity converted to minutes; never a clock or event duration.
        minutes: f64,
    },
}

/// An explicit event end or duration; absence receives the one-hour product default.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EndExpression {
    /// An explicitly requested end clock, optionally on another date.
    At {
        /// Explicit end date; null inherits the start date, rolling overnight if needed.
        date: Option<DateExpression>,
        /// Explicit end clock.
        clock: ClockExpression,
    },
    /// Explicit event duration, separated from relative-start offsets.
    After {
        /// Exact duration phrase, excluding included sub-durations and discussion topics.
        span: String,
        /// Complete duration converted to whole minutes; fractional hours may yield whole minutes.
        minutes: f64,
    },
}

/// Task deadline facts only; an absent deadline stays null.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskTemporalExpressions {
    /// Explicit deadline expression, excluding dates merely mentioned in the task description.
    pub due: Option<StartExpression>,
}

/// Calendar timing facts, without model-computed dates or defaults.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalendarTemporalExpressions {
    /// Scheduling expression; null when none was supplied.
    pub start: Option<StartExpression>,
    /// Explicit end or duration; null means the application's one-hour default.
    pub end: Option<EndExpression>,
    /// Explicit repetition; null for a one-off event.
    pub recurrence: Option<RecurrenceExpression>,
}

/// Repetition units supported by the shared calendar editor.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum RecurrenceFrequency {
    /// Every N days.
    Daily,
    /// Every N weeks.
    Weekly,
    /// Every N months.
    Monthly,
    /// Every N years.
    Yearly,
}

/// RFC weekday values used by the existing recurrence UI.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, ToSchema)]
pub enum WeekdayCode {
    /// Monday.
    #[serde(rename = "MO")]
    Monday,
    /// Tuesday.
    #[serde(rename = "TU")]
    Tuesday,
    /// Wednesday.
    #[serde(rename = "WE")]
    Wednesday,
    /// Thursday.
    #[serde(rename = "TH")]
    Thursday,
    /// Friday.
    #[serde(rename = "FR")]
    Friday,
    /// Saturday.
    #[serde(rename = "SA")]
    Saturday,
    /// Sunday.
    #[serde(rename = "SU")]
    Sunday,
}

/// Monthly ordinal weekday, such as the first Friday.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MonthlyWeekday {
    /// One through five, or minus one for last.
    pub ordinal: i32,
    /// Weekday selected by the ordinal.
    pub weekday: WeekdayCode,
}

/// A recurrence's explicit ending condition.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RecurrenceEndExpression {
    /// No explicit ending condition.
    Never,
    /// Stop after this many occurrences.
    After {
        /// Explicit positive occurrence count.
        count: u32,
    },
    /// Include occurrences through this local calendar date.
    On {
        /// Explicit end-date expression, resolved by Rust.
        date: DateExpression,
    },
}

/// Explicit repetition facts, not a model-generated RRULE string.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RecurrenceExpression {
    /// Exact repetition phrase from the draft.
    pub span: String,
    /// Repetition unit.
    pub frequency: RecurrenceFrequency,
    /// Explicit interval, or one for an unqualified repetition unit.
    pub interval: u32,
    /// Explicit weekly weekdays, empty when recurrence follows the event's start day.
    pub by_day: Vec<WeekdayCode>,
    /// Explicit monthly positional weekday; null otherwise.
    pub monthly_by_day: Option<MonthlyWeekday>,
    /// Explicit ending condition, or never when unspecified.
    pub ends: RecurrenceEndExpression,
}

/// Resolved recurrence ending condition accepted by the shared calendar editor.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecurrenceEnd {
    /// No ending condition.
    Never,
    /// Explicit occurrence limit.
    After {
        /// Positive occurrence count.
        count: u32,
    },
    /// Inclusive local ISO date.
    On {
        /// Date resolved against the request's clock and timezone.
        date: String,
    },
}

/// Resolved, editable repetition values; the existing calendar serializer builds RRULEs.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RecurrenceSuggestion {
    /// Repetition unit.
    pub frequency: RecurrenceFrequency,
    /// Positive interval.
    pub interval: u32,
    /// Weekly weekday selectors.
    pub by_day: Vec<WeekdayCode>,
    /// Monthly ordinal weekday, if explicitly supplied.
    pub monthly_by_day: Option<MonthlyWeekday>,
    /// Resolved ending condition.
    pub ends: RecurrenceEnd,
}

/// Temporal facts bundled with the destination they apply to.
#[derive(Debug, Clone)]
pub enum TemporalExpressions {
    /// Task deadline expression.
    Task(TaskTemporalExpressions),
    /// Event timing and repetition expressions.
    Calendar(CalendarTemporalExpressions),
}
