use super::*;
use crate::domain::{CalendarSuggestions, TaskSuggestions};
use chrono::Utc;

fn input(text: &str) -> ExtractInputRequest {
    ExtractInputRequest {
        text: text.into(),
        intent: InputIntent::Calendar,
        revision: 1,
        reference_time: "2026-10-23T18:00:00Z".parse::<DateTime<Utc>>().unwrap(),
        time_zone: "America/New_York".into(),
        search_type: None,
        property_definitions: vec![],
    }
}

#[test]
fn next_weekdays_follow_calendar_weeks_instead_of_model_computed_dates() {
    let mut request = input("finish report by next Friday");
    request.intent = InputIntent::Task;
    request.reference_time = "2026-10-26T18:00:00Z".parse().unwrap();
    let expression = DateExpression::Weekday {
        span: "by next Friday".into(),
        weekday: Weekday::Friday,
        week: WeekRelation::Next,
    };
    let reference = request
        .reference_time
        .with_timezone(&chrono_tz::America::New_York);
    assert_eq!(
        date(&expression, &request, reference).unwrap().to_string(),
        "2026-11-06"
    );
    let mut fields = InputSuggestions::Task(TaskSuggestions {
        title: Some(request.text.clone()),
        ..Default::default()
    });
    apply(
        &mut fields,
        TemporalExpressions::Task(TaskTemporalExpressions {
            due: Some(StartExpression::Local {
                date: Some(expression),
                clock: None,
            }),
        }),
        &request,
    )
    .unwrap();
    let InputSuggestions::Task(fields) = fields else {
        panic!("wrong intent");
    };
    assert_eq!(fields.due_date.as_deref(), Some("2026-11-06"));
    assert!(!fields.title.unwrap().contains("by next Friday"));
}

#[test]
fn explicit_clock_markers_and_bare_hour_defaults_are_resolved_without_scanning_the_draft() {
    for (span, hour, minute, meridiem, daypart, expected, assumed) in [
        ("7", 7, 0, None, None, "19:00:00", true),
        ("7 a.m.", 7, 0, Some(Meridiem::Am), None, "07:00:00", false),
        ("07:00", 7, 0, None, None, "07:00:00", false),
        ("15:30", 15, 30, None, None, "15:30:00", false),
        ("noon", 12, 0, None, Some(Daypart::Noon), "12:00:00", false),
        (
            "midnight",
            0,
            0,
            None,
            Some(Daypart::Midnight),
            "00:00:00",
            false,
        ),
    ] {
        let request = input(&format!("Call Julia tomorrow at {span}"));
        let result = clock(
            &ClockExpression {
                span: span.into(),
                hour,
                minute,
                meridiem,
                daypart,
            },
            &request,
        )
        .unwrap();
        assert_eq!(result.0.to_string(), expected);
        assert_eq!(result.1, assumed);
    }
}

#[test]
fn invalid_dates_clocks_and_unbacked_spans_are_rejected() {
    let request = input("Workshop on 2026-02-30 at 10");
    let reference = request
        .reference_time
        .with_timezone(&chrono_tz::America::New_York);
    assert!(
        date(
            &DateExpression::Absolute {
                span: "2026-02-30".into(),
                year: Some(2026),
                month: 2,
                day: 30
            },
            &request,
            reference
        )
        .is_err()
    );
    assert!(
        clock(
            &ClockExpression {
                span: "10".into(),
                hour: 30,
                minute: 0,
                meridiem: None,
                daypart: None
            },
            &request
        )
        .is_err()
    );
    assert!(
        clock(
            &ClockExpression {
                span: "invented".into(),
                hour: 10,
                minute: 0,
                meridiem: None,
                daypart: None
            },
            &request
        )
        .is_err()
    );
    assert!(elapsed(f64::NAN).is_err());
    assert!(elapsed(f64::INFINITY).is_err());
    assert!(elapsed(0.5).is_err());
    assert_eq!(elapsed(30.0).unwrap(), Duration::minutes(30));
}

#[test]
fn explicit_end_clocks_roll_overnight_but_equal_and_reversed_dates_are_rejected() {
    let request = input("Dinner tomorrow 9pm to 1am");
    let expression = |end_hour| {
        TemporalExpressions::Calendar(CalendarTemporalExpressions {
            start: Some(StartExpression::Local {
                date: Some(DateExpression::RelativeDay {
                    span: "tomorrow".into(),
                    offset_days: 1,
                }),
                clock: Some(ClockExpression {
                    span: "9pm".into(),
                    hour: 9,
                    minute: 0,
                    meridiem: Some(Meridiem::Pm),
                    daypart: None,
                }),
            }),
            end: Some(EndExpression::At {
                date: None,
                clock: ClockExpression {
                    span: if end_hour == 9 { "9pm" } else { "1am" }.into(),
                    hour: end_hour,
                    minute: 0,
                    meridiem: Some(if end_hour == 9 {
                        Meridiem::Pm
                    } else {
                        Meridiem::Am
                    }),
                    daypart: None,
                },
            }),
            recurrence: None,
        })
    };
    let mut fields = InputSuggestions::Calendar(CalendarSuggestions::default());
    apply(&mut fields, expression(1), &request).unwrap();
    let InputSuggestions::Calendar(ref result) = fields else {
        panic!("wrong intent")
    };
    assert_eq!(result.start.as_deref(), Some("2026-10-24T21:00"));
    assert_eq!(result.end.as_deref(), Some("2026-10-25T01:00"));
    assert!(apply(&mut fields, expression(9), &request).is_err());
}

#[test]
fn recurrence_cutoff_is_resolved_separately_from_first_occurrence() {
    let request = input("every Friday until December 31");
    let expression = RecurrenceExpression {
        span: request.text.clone(),
        frequency: RecurrenceFrequency::Weekly,
        interval: 1,
        by_day: vec![WeekdayCode::Friday],
        monthly_by_day: None,
        ends: RecurrenceEndExpression::On {
            date: DateExpression::Absolute {
                span: "December 31".into(),
                year: None,
                month: 12,
                day: 31,
            },
        },
    };
    let reference = request
        .reference_time
        .with_timezone(&chrono_tz::America::New_York);
    let result = recurrence(expression.clone(), &request, reference).unwrap();
    assert!(matches!(result.ends, RecurrenceEnd::On { date } if date == "2026-12-31"));
    assert!(
        recurrence(
            RecurrenceExpression {
                interval: 0,
                ..expression.clone()
            },
            &request,
            reference
        )
        .is_err()
    );
    assert!(
        recurrence(
            RecurrenceExpression {
                ends: RecurrenceEndExpression::After { count: 0 },
                ..expression
            },
            &request,
            reference
        )
        .is_err()
    );
}

#[test]
fn relative_starts_are_distinct_from_durations_and_use_elapsed_time() {
    let request = input("Call Julia in 30 minutes for half an hour");
    let mut fields = InputSuggestions::Calendar(CalendarSuggestions::default());
    apply(
        &mut fields,
        TemporalExpressions::Calendar(CalendarTemporalExpressions {
            start: Some(StartExpression::Relative {
                span: "in 30 minutes".into(),
                minutes: 30.0,
            }),
            end: Some(EndExpression::After {
                span: "half an hour".into(),
                minutes: 30.0,
            }),
            recurrence: None,
        }),
        &request,
    )
    .unwrap();
    let InputSuggestions::Calendar(fields) = fields else {
        panic!("wrong intent");
    };
    assert_eq!(fields.start.as_deref(), Some("2026-10-23T14:30"));
    assert_eq!(fields.end.as_deref(), Some("2026-10-23T15:00"));
}

#[test]
fn date_and_time_arithmetic_rejects_nonexistent_and_ambiguous_local_clocks() {
    let zone = chrono_tz::America::New_York;
    assert!(
        instant(
            NaiveDate::from_ymd_opt(2026, 3, 8).unwrap(),
            NaiveTime::from_hms_opt(2, 30, 0).unwrap(),
            zone
        )
        .is_err()
    );
    assert!(
        instant(
            NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
            NaiveTime::from_hms_opt(1, 30, 0).unwrap(),
            zone
        )
        .is_err()
    );
}

#[test]
fn upcoming_today_with_a_past_clock_moves_one_week_but_this_week_does_not() {
    let request = input("Call Friday at 9am");
    let reference = request
        .reference_time
        .with_timezone(&chrono_tz::America::New_York);
    for (week, expected) in [
        (WeekRelation::Upcoming, "2026-10-30T09:00"),
        (WeekRelation::This, "2026-10-23T09:00"),
    ] {
        let resolved = start(
            &StartExpression::Local {
                date: Some(DateExpression::Weekday {
                    span: "Friday".into(),
                    weekday: Weekday::Friday,
                    week,
                }),
                clock: Some(ClockExpression {
                    span: "9am".into(),
                    hour: 9,
                    minute: 0,
                    meridiem: Some(Meridiem::Am),
                    daypart: None,
                }),
            },
            &request,
            reference,
            false,
        )
        .unwrap();
        assert_eq!(
            resolved
                .instant
                .unwrap()
                .format("%Y-%m-%dT%H:%M")
                .to_string(),
            expected
        );
    }
}

#[test]
fn a_repeat_cutoff_cannot_precede_the_first_occurrence() {
    let request = input("Meet tomorrow at noon repeat daily until today");
    let mut fields = InputSuggestions::Calendar(CalendarSuggestions::default());
    let expressions = TemporalExpressions::Calendar(CalendarTemporalExpressions {
        start: Some(StartExpression::Local {
            date: Some(DateExpression::RelativeDay {
                span: "tomorrow".into(),
                offset_days: 1,
            }),
            clock: Some(ClockExpression {
                span: "noon".into(),
                hour: 12,
                minute: 0,
                meridiem: None,
                daypart: Some(Daypart::Noon),
            }),
        }),
        end: None,
        recurrence: Some(RecurrenceExpression {
            span: "repeat daily until today".into(),
            frequency: RecurrenceFrequency::Daily,
            interval: 1,
            by_day: vec![],
            monthly_by_day: None,
            ends: RecurrenceEndExpression::On {
                date: DateExpression::RelativeDay {
                    span: "today".into(),
                    offset_days: 0,
                },
            },
        }),
    });
    assert!(apply(&mut fields, expressions, &request).is_err());
    assert!(
        clock(
            &ClockExpression {
                span: "noon".into(),
                hour: 0,
                minute: 0,
                meridiem: None,
                daypart: Some(Daypart::Noon)
            },
            &request
        )
        .is_err()
    );
}

#[test]
fn absolute_dates_reject_numeric_facts_that_are_not_in_their_source() {
    let request = input("Dinner December 31; repeat until next Friday");
    let reference = request
        .reference_time
        .with_timezone(&chrono_tz::America::New_York);
    assert!(
        date(
            &DateExpression::Absolute {
                span: "December 31".into(),
                year: Some(2024),
                month: 12,
                day: 31
            },
            &request,
            reference
        )
        .is_err()
    );
    assert!(
        date(
            &DateExpression::Absolute {
                span: "next Friday".into(),
                year: None,
                month: 5,
                day: 15
            },
            &request,
            reference
        )
        .is_err()
    );
    assert_eq!(
        date(
            &DateExpression::Absolute {
                span: "December 31".into(),
                year: None,
                month: 12,
                day: 31
            },
            &request,
            reference
        )
        .unwrap()
        .to_string(),
        "2026-12-31"
    );
}

#[test]
fn named_night_clocks_distinguish_late_evening_from_after_midnight() {
    for (hour, expected) in [
        (1, "01:00:00"),
        (12, "00:00:00"),
        (7, "19:00:00"),
        (23, "23:00:00"),
    ] {
        let phrase = format!("{hour} at night");
        let request = input(&format!("Call tomorrow at {phrase}"));
        let (time, assumed) = clock(
            &ClockExpression {
                span: phrase,
                hour,
                minute: 0,
                meridiem: None,
                daypart: Some(Daypart::Night),
            },
            &request,
        )
        .unwrap();
        assert_eq!(time.to_string(), expected);
        assert!(!assumed);
    }
}
