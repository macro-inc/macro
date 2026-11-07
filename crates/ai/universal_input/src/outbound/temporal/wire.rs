//! Provider facts are distinct from domain expressions; absence is an empty list.
use crate::domain::temporal::*;
use crate::domain::{InputError, InputIntent};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum Role {
    Start,
    End,
}

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum Period {
    Am,
    Pm,
    Morning,
    Afternoon,
    Evening,
    Night,
    Noon,
    Midnight,
}
impl Period {
    fn components(period: Option<Self>) -> (Option<Meridiem>, Option<Daypart>) {
        match period {
            Some(Self::Am) => (Some(Meridiem::Am), None),
            Some(Self::Pm) => (Some(Meridiem::Pm), None),
            Some(Self::Morning) => (None, Some(Daypart::Morning)),
            Some(Self::Afternoon) => (None, Some(Daypart::Afternoon)),
            Some(Self::Evening) => (None, Some(Daypart::Evening)),
            Some(Self::Night) => (None, Some(Daypart::Night)),
            Some(Self::Noon) => (None, Some(Daypart::Noon)),
            Some(Self::Midnight) => (None, Some(Daypart::Midnight)),
            None => (None, None),
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Fact {
    Absolute {
        /// start is the beginning or task deadline; end is an explicitly stated first-occurrence ending, never a series cutoff.
        role: Role,
        /// Exact substring of the current draft; preserve its spelling and spacing.
        span: String,
        /// Only the explicitly written year; null when absent.
        year: Option<i32>,
        /// Written calendar month from one through twelve.
        month: u32,
        /// Written day of month, including impossible dates for Rust to reject.
        day: u32,
    },
    RelativeDay {
        /// start is the beginning or task deadline; end is an explicitly stated first-occurrence ending, never a series cutoff.
        role: Role,
        /// Exact substring of the current draft; preserve its spelling and spacing.
        span: String,
        /// Calendar days from today: today zero, tomorrow one, day after tomorrow two. Never a minute quantity.
        offset_days: i32,
    },
    Weekday {
        /// start is the beginning or task deadline; end is an explicitly stated first-occurrence ending, never a series cutoff.
        role: Role,
        /// Exact substring of the current draft; preserve its spelling and spacing.
        span: String,
        /// Named weekday as a name, including abbreviations and obvious misspellings. Do not calculate a weekday number.
        weekday: Weekday,
        /// next is the following Monday–Sunday; this is the current week; a bare weekday is upcoming.
        week: WeekRelation,
    },
    Clock {
        /// start is the beginning or task deadline; end is an explicitly stated first-occurrence ending, never a series cutoff.
        role: Role,
        /// Exact substring of the current draft; preserve its spelling and spacing.
        span: String,
        /// Raw written hour before AM/PM conversion. Noon twelve; midnight zero.
        hour: u32,
        /// Written minute, or zero when no minutes were supplied.
        minute: u32,
        /// Only an explicit AM/PM or named daypart. Noon is noon, midnight is midnight; null when no marker was supplied. Never infer a period.
        period: Option<Period>,
    },
    /// An explicitly supplied elapsed start offset, never a duration.
    Offset {
        /// Exact substring of the current draft; preserve its spelling and spacing.
        span: String,
        /// Explicit quantity converted to minutes, without defaults.
        minutes: f64,
    },
    /// The entire explicitly supplied event length. Included subparts are not added: two hours including thirty minutes is 120 minutes.
    Duration {
        /// Exact substring of the current draft; preserve its spelling and spacing.
        span: String,
        /// Explicit quantity converted to minutes, without defaults.
        minutes: f64,
    },
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Repetition {
    span: String,
    frequency: RecurrenceFrequency,
    interval: u32,
    by_day: Vec<WeekdayCode>,
    #[schemars(length(max = 1))]
    monthly_by_day: Vec<MonthlyWeekday>,
    ends: RecurrenceEndExpression,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Facts {
    expressions: Vec<Fact>,
    #[schemars(length(max = 1))]
    recurrence: Vec<Repetition>,
}

fn set_once<T>(slot: &mut Option<T>, value: T) -> Result<(), InputError> {
    if slot.replace(value).is_some() {
        return Err(InputError::Extraction);
    }
    Ok(())
}

impl Facts {
    pub(super) fn into_expressions(
        self,
        intent: InputIntent,
    ) -> Result<TemporalExpressions, InputError> {
        let (
            mut start_date,
            mut end_date,
            mut start_clock,
            mut end_clock,
            mut offset,
            mut duration,
        ) = (None, None, None, None, None, None);
        for fact in self.expressions {
            let date = match fact {
                Fact::Absolute {
                    role,
                    span,
                    year,
                    month,
                    day,
                } => Some((
                    role,
                    DateExpression::Absolute {
                        span,
                        year,
                        month,
                        day,
                    },
                )),
                Fact::RelativeDay {
                    role,
                    span,
                    offset_days,
                } => Some((role, DateExpression::RelativeDay { span, offset_days })),
                Fact::Weekday {
                    role,
                    span,
                    weekday,
                    week,
                } => Some((
                    role,
                    DateExpression::Weekday {
                        span,
                        weekday,
                        week,
                    },
                )),
                Fact::Clock {
                    role,
                    span,
                    hour,
                    minute,
                    period,
                } => {
                    let (meridiem, daypart) = Period::components(period);
                    set_once(
                        match role {
                            Role::Start => &mut start_clock,
                            Role::End => &mut end_clock,
                        },
                        ClockExpression {
                            span,
                            hour,
                            minute,
                            meridiem,
                            daypart,
                        },
                    )?;
                    None
                }
                Fact::Offset { span, minutes } => {
                    set_once(&mut offset, StartExpression::Relative { span, minutes })?;
                    None
                }
                Fact::Duration { span, minutes } => {
                    set_once(&mut duration, EndExpression::After { span, minutes })?;
                    None
                }
            };
            if let Some((role, date)) = date {
                set_once(
                    match role {
                        Role::Start => &mut start_date,
                        Role::End => &mut end_date,
                    },
                    date,
                )?;
            }
        }
        if (offset.is_some() && (start_date.is_some() || start_clock.is_some()))
            || (duration.is_some() && end_clock.is_some())
            || (end_date.is_some() && end_clock.is_none())
            || self.recurrence.len() > 1
        {
            return Err(InputError::Extraction);
        }
        let start = offset.or_else(|| {
            if start_date.is_some() || start_clock.is_some() {
                Some(StartExpression::Local {
                    date: start_date,
                    clock: start_clock,
                })
            } else {
                None
            }
        });
        let end = duration.or_else(|| {
            end_clock.map(|clock| EndExpression::At {
                date: end_date,
                clock,
            })
        });
        let recurrence = self
            .recurrence
            .into_iter()
            .next()
            .map(|r| {
                if r.monthly_by_day.len() > 1 {
                    return Err(InputError::Extraction);
                }
                Ok(RecurrenceExpression {
                    span: r.span,
                    frequency: r.frequency,
                    interval: r.interval,
                    by_day: r.by_day,
                    monthly_by_day: r.monthly_by_day.into_iter().next(),
                    ends: r.ends,
                })
            })
            .transpose()?;
        match intent {
            InputIntent::Task if end.is_none() && recurrence.is_none() => {
                Ok(TemporalExpressions::Task(TaskTemporalExpressions {
                    due: start,
                }))
            }
            InputIntent::Calendar => {
                Ok(TemporalExpressions::Calendar(CalendarTemporalExpressions {
                    start,
                    end,
                    recurrence,
                }))
            }
            _ => Err(InputError::Extraction),
        }
    }
}

#[cfg(test)]
mod test;
