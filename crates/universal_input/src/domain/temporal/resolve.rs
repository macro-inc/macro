//! Calendar arithmetic and source validation, with no language parsing.
use super::*;
use chrono::{DateTime, Datelike, Days, Duration, NaiveDate, NaiveTime, TimeZone};
use chrono_tz::Tz;

#[cfg(test)]
mod test;

fn source(span: &str, text: &str) -> Result<(), InputError> {
    if span.trim().is_empty() || !text.contains(span) {
        return Err(InputError::Extraction);
    }
    Ok(())
}

/// A written month and day must be grounded in its span: this rejects a model
/// inventing a year or turning a weekday into a month and day. Spelled-out numeric
/// dates remain unresolved rather than authorizing a guess.
fn absolute_source(span: &str, text: &str, year: Option<i32>, day: u32) -> Result<(), InputError> {
    source(span, text)?;
    if !span.contains(&day.to_string())
        || year.is_some_and(|year| !span.contains(&year.to_string()))
    {
        return Err(InputError::Extraction);
    }
    Ok(())
}

fn elapsed(minutes: f64) -> Result<Duration, InputError> {
    let milliseconds = minutes * 60_000.0;
    // Composer timestamps have minute precision. Reject unsupported fractions rather
    // than silently truncating an explicit duration into a default one-hour event.
    if !minutes.is_finite() || minutes.fract() != 0.0 || milliseconds.abs() > i64::MAX as f64 {
        return Err(InputError::Extraction);
    }
    Duration::try_milliseconds(milliseconds.round() as i64).ok_or(InputError::Extraction)
}

fn weekday_index(day: Weekday) -> u32 {
    match day {
        Weekday::Monday => 0,
        Weekday::Tuesday => 1,
        Weekday::Wednesday => 2,
        Weekday::Thursday => 3,
        Weekday::Friday => 4,
        Weekday::Saturday => 5,
        Weekday::Sunday => 6,
    }
}

/// The day `expression`, written in `text`, names, counting from `today`.
pub(super) fn date(
    expression: &DateExpression,
    text: &str,
    today: NaiveDate,
) -> Result<NaiveDate, InputError> {
    match expression {
        DateExpression::Absolute {
            span,
            year,
            month,
            day,
        } => {
            absolute_source(span, text, *year, *day)?;
            if let Some(year) = year {
                return NaiveDate::from_ymd_opt(*year, *month, *day).ok_or(InputError::Extraction);
            }
            (0..=4)
                .filter_map(|offset| {
                    NaiveDate::from_ymd_opt(today.year().checked_add(offset)?, *month, *day)
                })
                .find(|candidate| *candidate >= today)
                .ok_or(InputError::Extraction)
        }
        DateExpression::RelativeDay { span, offset_days } => {
            source(span, text)?;
            today
                .checked_add_signed(Duration::days(i64::from(*offset_days)))
                .ok_or(InputError::Extraction)
        }
        DateExpression::Weekday {
            span,
            weekday,
            week,
        } => {
            source(span, text)?;
            let current = today.weekday().num_days_from_monday();
            let wanted = weekday_index(*weekday);
            let offset = match week {
                WeekRelation::This => i64::from(wanted) - i64::from(current),
                WeekRelation::Next => 7 + i64::from(wanted) - i64::from(current),
                WeekRelation::Upcoming => i64::from((wanted + 7 - current) % 7),
            };
            today
                .checked_add_signed(Duration::days(offset))
                .ok_or(InputError::Extraction)
        }
    }
}

fn clock(
    expression: &ClockExpression,
    input: &ExtractInputRequest,
) -> Result<(NaiveTime, bool), InputError> {
    source(&expression.span, &input.text)?;
    let raw = expression.hour;
    if raw > 23 || expression.minute > 59 {
        return Err(InputError::Extraction);
    }
    if matches!(expression.daypart, Some(Daypart::Noon)) && (raw != 12 || expression.minute != 0)
        || matches!(expression.daypart, Some(Daypart::Midnight))
            && (raw != 0 || expression.minute != 0)
    {
        return Err(InputError::Extraction);
    }
    let mut assumed = false;
    let hour = if let Some(meridiem) = expression.meridiem {
        if !(1..=12).contains(&raw) {
            return Err(InputError::Extraction);
        }
        raw % 12
            + if matches!(meridiem, Meridiem::Pm) {
                12
            } else {
                0
            }
    } else if let Some(part) = expression.daypart {
        match part {
            Daypart::Noon => 12,
            Daypart::Midnight => 0,
            Daypart::Morning => raw % 12,
            Daypart::Afternoon | Daypart::Evening => raw % 12 + 12,
            Daypart::Night => {
                if raw == 12 {
                    0
                } else if raw <= 5 || raw >= 13 {
                    raw
                } else {
                    raw + 12
                }
            }
        }
    } else if (1..=12).contains(&raw) && !expression.span.trim_start().starts_with('0') {
        assumed = true;
        if raw <= 7 { raw + 12 } else { raw }
    } else {
        raw
    };
    Ok((
        NaiveTime::from_hms_opt(hour, expression.minute, 0).ok_or(InputError::Extraction)?,
        assumed,
    ))
}

fn instant(day: NaiveDate, time: NaiveTime, zone: Tz) -> Result<DateTime<Tz>, InputError> {
    zone.from_local_datetime(&day.and_time(time))
        .single()
        .ok_or(InputError::Extraction)
}

struct ResolvedStart {
    instant: Option<DateTime<Tz>>,
    day: Option<NaiveDate>,
    assumption: Option<String>,
}

fn start(
    expression: &StartExpression,
    input: &ExtractInputRequest,
    reference: DateTime<Tz>,
) -> Result<ResolvedStart, InputError> {
    match expression {
        StartExpression::Relative { span, minutes } => {
            source(span, &input.text)?;
            let value = reference
                .checked_add_signed(elapsed(*minutes)?)
                .ok_or(InputError::Extraction)?;
            Ok(ResolvedStart {
                instant: Some(value),
                day: Some(value.date_naive()),
                assumption: None,
            })
        }
        StartExpression::Local {
            date: expression_date,
            clock: expression_clock,
        } => {
            let mut day = expression_date
                .as_ref()
                .map(|d| date(d, &input.text, reference.date_naive()))
                .transpose()?;
            let time = expression_clock
                .as_ref()
                .map(|c| clock(c, input))
                .transpose()?;
            if let (Some(d), Some((t, _))) = (day, time)
                && matches!(
                    expression_date,
                    Some(DateExpression::Weekday {
                        week: WeekRelation::Upcoming,
                        ..
                    })
                )
                && d == reference.date_naive()
                && t < reference.time()
            {
                day = Some(
                    d.checked_add_days(Days::new(7))
                        .ok_or(InputError::Extraction)?,
                );
            }
            // A clock without a date is its next occurrence: today, or tomorrow
            // once that clock has passed.
            if let (None, Some((t, _))) = (day, time) {
                let today = reference.date_naive();
                day = Some(if t < reference.time() {
                    today
                        .checked_add_days(Days::new(1))
                        .ok_or(InputError::Extraction)?
                } else {
                    today
                });
            }
            let value = match (day, time) {
                (Some(d), Some((t, _))) => Some(instant(d, t, reference.timezone())?),
                _ => None,
            };
            if expression_date.is_none() && expression_clock.is_none() {
                return Err(InputError::Extraction);
            }
            let assumption = expression_clock
                .as_ref()
                .and_then(|c| time.filter(|(_, assumed)| *assumed).map(|_| c.span.clone()));
            Ok(ResolvedStart {
                instant: value,
                day,
                assumption,
            })
        }
    }
}

fn remove_span(text: &mut Option<String>, span: &str, input: &ExtractInputRequest) {
    if input.text.match_indices(span).count() != 1 {
        return;
    }
    if let Some(value) = text
        && value.match_indices(span).count() == 1
    {
        *value = value.replacen(span, "", 1).trim_matches('\n').to_owned();
    }
}

pub(super) fn apply(
    suggestions: &mut InputSuggestions,
    expressions: TemporalExpressions,
    input: &ExtractInputRequest,
) -> Result<(), InputError> {
    let zone = input
        .time_zone
        .parse::<Tz>()
        .map_err(|_| InputError::InvalidTimeZone)?;
    let reference = input.reference_time.with_timezone(&zone);
    match (suggestions, expressions) {
        (InputSuggestions::Task(fields), TemporalExpressions::Task(expressions)) => {
            fields.due_date = None;
            if let Some(expression) = expressions.due {
                let resolved = start(&expression, input, reference)?;
                fields.due_date = resolved
                    .instant
                    .map(|d| d.format("%Y-%m-%dT%H:%M").to_string())
                    .or_else(|| resolved.day.map(|d| d.format("%Y-%m-%d").to_string()));
                match &expression {
                    StartExpression::Relative { span, .. } => {
                        remove_span(&mut fields.title, span, input);
                        remove_span(&mut fields.body, span, input);
                    }
                    StartExpression::Local { date: Some(d), .. } => {
                        let span = match d {
                            DateExpression::Absolute { span, .. }
                            | DateExpression::RelativeDay { span, .. }
                            | DateExpression::Weekday { span, .. } => span,
                        };
                        remove_span(&mut fields.title, span, input);
                        remove_span(&mut fields.body, span, input);
                    }
                    _ => {}
                }
            }
        }
        (InputSuggestions::Calendar(fields), TemporalExpressions::Calendar(expressions)) => {
            let resolved = expressions
                .start
                .as_ref()
                .map(|e| start(e, input, reference))
                .transpose()?;
            let starts_at = resolved.as_ref().and_then(|r| r.instant);
            fields.start = starts_at.map(|d| d.format("%Y-%m-%dT%H:%M").to_string());
            fields.start_assumption = resolved.and_then(|r| r.assumption);
            fields.end = match (starts_at, expressions.end) {
                (Some(start), Some(EndExpression::After { span, minutes })) => {
                    source(&span, &input.text)?;
                    let duration = elapsed(minutes)?;
                    if duration <= Duration::zero() {
                        return Err(InputError::Extraction);
                    }
                    Some(
                        start
                            .checked_add_signed(duration)
                            .ok_or(InputError::Extraction)?,
                    )
                }
                (
                    Some(start),
                    Some(EndExpression::At {
                        date: end_date,
                        clock: end_clock,
                    }),
                ) => {
                    let time = clock(&end_clock, input)?.0;
                    let explicit_date = end_date.is_some();
                    let mut day = end_date
                        .as_ref()
                        .map(|d| date(d, &input.text, reference.date_naive()))
                        .transpose()?
                        .unwrap_or(start.date_naive());
                    if !explicit_date && time < start.time() {
                        day = day
                            .checked_add_days(Days::new(1))
                            .ok_or(InputError::Extraction)?;
                    }
                    let end = instant(day, time, zone)?;
                    if end <= start {
                        return Err(InputError::Extraction);
                    }
                    Some(end)
                }
                _ => None,
            }
            .map(|d| d.format("%Y-%m-%dT%H:%M").to_string());
            fields.recurrence = expressions
                .recurrence
                .map(|e| recurrence(e, input, reference))
                .transpose()?;
            if let (
                Some(start),
                Some(RecurrenceSuggestion {
                    ends: RecurrenceEnd::On { date },
                    ..
                }),
            ) = (starts_at, fields.recurrence.as_ref())
                && date.as_str() < start.format("%Y-%m-%d").to_string().as_str()
            {
                return Err(InputError::Extraction);
            }
        }
        _ => return Err(InputError::Extraction),
    }
    Ok(())
}

fn recurrence(
    expression: RecurrenceExpression,
    input: &ExtractInputRequest,
    reference: DateTime<Tz>,
) -> Result<RecurrenceSuggestion, InputError> {
    source(&expression.span, &input.text)?;
    if expression.interval == 0
        || expression
            .monthly_by_day
            .as_ref()
            .is_some_and(|d| !matches!(d.ordinal, -1 | 1..=5))
    {
        return Err(InputError::Extraction);
    }
    let ends = match expression.ends {
        RecurrenceEndExpression::Never => RecurrenceEnd::Never,
        RecurrenceEndExpression::After { count } if count > 0 => RecurrenceEnd::After { count },
        RecurrenceEndExpression::On { date: d } => RecurrenceEnd::On {
            date: date(&d, &input.text, reference.date_naive())?
                .format("%Y-%m-%d")
                .to_string(),
        },
        _ => return Err(InputError::Extraction),
    };
    Ok(RecurrenceSuggestion {
        frequency: expression.frequency,
        interval: expression.interval,
        by_day: expression.by_day,
        monthly_by_day: expression.monthly_by_day,
        ends,
    })
}

/// The day `expression`, written on `today` in `text` about something already
/// over, names: the latest such day on or before `latest` (`today`, or the day
/// before it when the wording puts the day earlier), or `None` when it names
/// none. A month and day with no year is its latest occurrence (that year's or
/// the year before), and a bare weekday the latest such day; relative days and
/// weekdays of this or next week count from `today` as ever, so one after
/// `latest` names nothing past.
pub(super) fn past_date(
    expression: &DateExpression,
    text: &str,
    today: NaiveDate,
    latest: NaiveDate,
) -> Result<Option<NaiveDate>, InputError> {
    match expression {
        DateExpression::Absolute {
            span,
            year: None,
            month,
            day,
        } => {
            absolute_source(span, text, None, *day)?;
            Ok((0..=1)
                .filter_map(|back| {
                    NaiveDate::from_ymd_opt(latest.year().checked_sub(back)?, *month, *day)
                })
                .find(|candidate| *candidate <= latest))
        }
        DateExpression::Weekday {
            span,
            weekday,
            week: WeekRelation::Upcoming,
        } => {
            source(span, text)?;
            let current = latest.weekday().num_days_from_monday();
            let back = (current + 7 - weekday_index(*weekday)) % 7;
            Ok(latest.checked_sub_days(Days::new(u64::from(back))))
        }
        _ => Ok(Some(date(expression, text, today)?).filter(|on| *on <= latest)),
    }
}
