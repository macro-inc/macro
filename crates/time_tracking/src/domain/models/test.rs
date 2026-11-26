use super::*;
use chrono::TimeZone;

fn at(hour: u32, minute: u32, second: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 20, hour, minute, second)
        .single()
        .unwrap()
}

fn day(year: i32, month: u32, date: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, date).unwrap()
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|logger@example.com").unwrap()
}

fn timer_started_at(started_at: DateTime<Utc>) -> RunningTimer {
    RunningTimer {
        id: Uuid::from_u128(0x71),
        task_id: "task-1".to_string(),
        started_at,
    }
}

#[test]
fn a_timer_stopped_now_logs_its_rounded_length_on_its_start_day() {
    let timer = timer_started_at(at(9, 0, 0));

    let row = finish_timer(&timer, &user(), at(10, 12, 31), TimerEnding::Now, None).unwrap();

    assert_eq!(row.id, timer.id);
    assert_eq!(row.source, TimeEntrySource::Timer);
    assert_eq!(row.values.minutes, 73);
    assert_eq!(row.values.date, day(2026, 11, 20));
    assert_eq!(
        row.values.span,
        Some(EntrySpan {
            started_at: at(9, 0, 0),
            ended_at: at(10, 12, 31),
        })
    );
}

#[test]
fn a_timer_under_half_a_minute_still_logs_one_minute() {
    let timer = timer_started_at(at(9, 0, 0));

    let row = finish_timer(&timer, &user(), at(9, 0, 12), TimerEnding::Now, None).unwrap();

    assert_eq!(row.values.minutes, 1);
}

#[test]
fn a_timer_past_the_limit_is_refused_until_the_person_says_what_to_log() {
    let timer = timer_started_at(at(1, 0, 0));

    let error = finish_timer(&timer, &user(), at(9, 0, 1), TimerEnding::Now, None).unwrap_err();

    assert!(matches!(error, TimeTrackingError::TimerOverLimit(refused) if refused == timer));
}

#[test]
fn a_timer_exactly_at_the_limit_still_stops() {
    let timer = timer_started_at(at(1, 0, 0));

    let row = finish_timer(&timer, &user(), at(9, 0, 0), TimerEnding::Now, None).unwrap();

    assert_eq!(row.values.minutes, 480);
}

#[test]
fn log_all_keeps_the_whole_run_past_the_limit() {
    let timer = timer_started_at(at(1, 0, 0));

    let row = finish_timer(&timer, &user(), at(11, 30, 0), TimerEnding::LogAll, None).unwrap();

    assert_eq!(row.values.minutes, 630);
}

#[test]
fn log_all_cannot_make_an_entry_longer_than_a_day() {
    let timer = timer_started_at(at(1, 0, 0));
    let now = at(1, 0, 0) + TimeDelta::hours(25);

    let error = finish_timer(&timer, &user(), now, TimerEnding::LogAll, None).unwrap_err();

    assert!(matches!(error, TimeTrackingError::InvalidInput(_)));
}

#[test]
fn a_stated_stop_time_ends_the_entry_there() {
    let timer = timer_started_at(at(1, 0, 0));

    let row = finish_timer(
        &timer,
        &user(),
        at(12, 0, 0),
        TimerEnding::At(at(3, 15, 0)),
        None,
    )
    .unwrap();

    assert_eq!(row.values.minutes, 135);
    assert_eq!(
        row.values.span.map(|span| span.ended_at),
        Some(at(3, 15, 0))
    );
}

#[test]
fn a_stated_stop_time_must_lie_between_the_start_and_now() {
    let timer = timer_started_at(at(1, 0, 0));

    for ended_at in [at(1, 0, 0), at(0, 30, 0), at(12, 0, 1)] {
        let error = finish_timer(
            &timer,
            &user(),
            at(12, 0, 0),
            TimerEnding::At(ended_at),
            None,
        )
        .unwrap_err();
        assert!(
            matches!(error, TimeTrackingError::InvalidInput(_)),
            "{ended_at}"
        );
    }
}

#[test]
fn work_begun_before_midnight_stays_on_its_day_in_the_stopping_zone() {
    // 04:50 UTC on the 21st is 23:50 on the 20th in New York.
    let started_at = Utc
        .with_ymd_and_hms(2026, 11, 21, 4, 50, 0)
        .single()
        .unwrap();
    let timer = timer_started_at(started_at);
    let zone = parse_time_zone(Some("America/New_York")).unwrap();

    let row = finish_timer(
        &timer,
        &user(),
        started_at + TimeDelta::minutes(40),
        TimerEnding::Now,
        zone,
    )
    .unwrap();

    assert_eq!(row.values.date, day(2026, 11, 20));
}

#[test]
fn without_a_zone_a_timer_entry_takes_the_utc_day() {
    let started_at = Utc
        .with_ymd_and_hms(2026, 11, 21, 4, 50, 0)
        .single()
        .unwrap();
    let timer = timer_started_at(started_at);

    let row = finish_timer(
        &timer,
        &user(),
        started_at + TimeDelta::minutes(40),
        TimerEnding::Now,
        None,
    )
    .unwrap();

    assert_eq!(row.values.date, day(2026, 11, 21));
}

#[test]
fn an_unknown_zone_is_refused_and_an_empty_one_means_utc() {
    assert!(matches!(
        parse_time_zone(Some("Mars/Olympus_Mons")),
        Err(TimeTrackingError::InvalidInput(_))
    ));
    assert_eq!(parse_time_zone(Some(" ")).unwrap(), None);
    assert_eq!(parse_time_zone(None).unwrap(), None);
}

#[test]
fn a_stop_names_a_time_or_log_all_but_not_both() {
    assert_eq!(
        TimerEnding::from_request(None, false).unwrap(),
        TimerEnding::Now
    );
    assert_eq!(
        TimerEnding::from_request(None, true).unwrap(),
        TimerEnding::LogAll
    );
    assert!(matches!(
        TimerEnding::from_request(Some(at(3, 0, 0)), true),
        Err(TimeTrackingError::InvalidInput(_))
    ));
}

#[test]
fn a_timer_starts_now_or_up_to_a_day_earlier() {
    let now = at(12, 0, 0);

    assert_eq!(timer_start(None, now).unwrap(), now);
    assert_eq!(
        timer_start(Some(now - TimeDelta::hours(24)), now).unwrap(),
        now - TimeDelta::hours(24)
    );
    for refused in [now + TimeDelta::seconds(1), now - TimeDelta::hours(25)] {
        assert!(matches!(
            timer_start(Some(refused), now),
            Err(TimeTrackingError::InvalidInput(_))
        ));
    }
}

#[test]
fn an_entry_is_between_one_minute_and_a_day() {
    let today = day(2026, 11, 20);

    for refused in [0, MAX_ENTRY_MINUTES + 1] {
        assert!(matches!(
            EntryValues::validate(today, refused, None, None, today),
            Err(TimeTrackingError::InvalidInput(_))
        ));
    }
    assert_eq!(
        EntryValues::validate(today, MAX_ENTRY_MINUTES, None, None, today)
            .unwrap()
            .minutes,
        1440
    );
}

#[test]
fn an_entry_is_dated_from_2000_to_a_year_ahead() {
    let today = day(2026, 11, 20);

    assert!(EntryValues::validate(day(2000, 1, 1), 30, None, None, today).is_ok());
    assert!(EntryValues::validate(day(2027, 11, 20), 30, None, None, today).is_ok());
    for refused in [day(1999, 12, 31), day(2027, 11, 21)] {
        assert!(matches!(
            EntryValues::validate(refused, 30, None, None, today),
            Err(TimeTrackingError::InvalidInput(_))
        ));
    }
}

#[test]
fn a_note_is_trimmed_dropped_when_blank_and_bounded() {
    let today = day(2026, 11, 20);
    let note = |text: &str| {
        EntryValues::validate(today, 30, Some(text.to_string()), None, today).map(|v| v.note)
    };

    assert_eq!(note("  review  ").unwrap(), Some("review".to_string()));
    assert_eq!(note("   ").unwrap(), None);
    assert_eq!(
        note(&"é".repeat(MAX_NOTE_CHARS))
            .unwrap()
            .map(|n| n.chars().count()),
        Some(MAX_NOTE_CHARS)
    );
    assert!(matches!(
        note(&"é".repeat(MAX_NOTE_CHARS + 1)),
        Err(TimeTrackingError::InvalidInput(_))
    ));
}

#[test]
fn a_typed_span_has_both_ends_in_order() {
    assert_eq!(EntrySpan::from_parts(None, None).unwrap(), None);
    assert!(
        EntrySpan::from_parts(Some(at(9, 0, 0)), Some(at(10, 0, 0)))
            .unwrap()
            .is_some()
    );
    for (started_at, ended_at) in [
        (Some(at(9, 0, 0)), None),
        (None, Some(at(9, 0, 0))),
        (Some(at(10, 0, 0)), Some(at(10, 0, 0))),
    ] {
        assert!(matches!(
            EntrySpan::from_parts(started_at, ended_at),
            Err(TimeTrackingError::InvalidInput(_))
        ));
    }
}

#[test]
fn an_edit_keeps_clears_or_sets_each_field() {
    let entry = TimeEntry {
        id: Uuid::from_u128(1),
        task_id: "task-1".to_string(),
        user_id: user(),
        date: day(2026, 11, 19),
        minutes: 45,
        note: Some("draft".to_string()),
        started_at: Some(at(9, 0, 0)),
        ended_at: Some(at(9, 45, 0)),
        source: TimeEntrySource::Manual,
        created_at: at(10, 0, 0),
        updated_at: at(10, 0, 0),
    };

    let kept = EntryValues::edited(&entry, TimeEntryChanges::default(), day(2026, 11, 20)).unwrap();
    assert_eq!(kept.note.as_deref(), Some("draft"));
    assert!(kept.span.is_some());

    let changed = EntryValues::edited(
        &entry,
        TimeEntryChanges {
            minutes: Some(60),
            note: FieldEdit::Clear,
            started_at: FieldEdit::Clear,
            ended_at: FieldEdit::Clear,
            ..TimeEntryChanges::default()
        },
        day(2026, 11, 20),
    )
    .unwrap();
    assert_eq!(changed.minutes, 60);
    assert_eq!(changed.note, None);
    assert_eq!(changed.span, None);
    assert_eq!(changed.date, day(2026, 11, 19));

    let half_cleared = EntryValues::edited(
        &entry,
        TimeEntryChanges {
            ended_at: FieldEdit::Clear,
            ..TimeEntryChanges::default()
        },
        day(2026, 11, 20),
    );
    assert!(matches!(
        half_cleared,
        Err(TimeTrackingError::InvalidInput(_))
    ));
}

#[test]
fn only_the_author_may_change_an_entry() {
    let entry = TimeEntry {
        id: Uuid::from_u128(1),
        task_id: "task-1".to_string(),
        user_id: user(),
        date: day(2026, 11, 19),
        minutes: 45,
        note: None,
        started_at: None,
        ended_at: None,
        source: TimeEntrySource::Manual,
        created_at: at(10, 0, 0),
        updated_at: at(10, 0, 0),
    };
    let someone_else = MacroUserIdStr::parse_from_str("macro|teammate@example.com").unwrap();

    assert!(may_change_entry(&entry, &user()));
    assert!(!may_change_entry(&entry, &someone_else));
}

#[test]
fn a_span_must_stay_ordered_at_the_precision_it_is_stored() {
    let start = at(10, 0, 0) + TimeDelta::nanoseconds(100);
    let end = at(10, 0, 0) + TimeDelta::nanoseconds(200);

    assert!(matches!(
        EntrySpan::from_parts(Some(start), Some(end)),
        Err(TimeTrackingError::InvalidInput(_))
    ));
    assert_eq!(
        EntrySpan::from_parts(Some(start), Some(at(10, 0, 1))).unwrap(),
        Some(EntrySpan {
            started_at: at(10, 0, 0),
            ended_at: at(10, 0, 1),
        })
    );
}

#[test]
fn a_note_with_a_nul_character_is_refused() {
    let today = day(2026, 11, 20);

    assert!(matches!(
        EntryValues::validate(today, 30, Some("a\0b".to_string()), None, today),
        Err(TimeTrackingError::InvalidInput(_))
    ));
}

#[test]
fn a_clock_behind_the_start_ends_the_span_just_after_it() {
    let timer = timer_started_at(at(10, 0, 0));

    for ending in [TimerEnding::Now, TimerEnding::LogAll] {
        let row = finish_timer(&timer, &user(), at(9, 59, 59), ending, None).unwrap();
        let span = row.values.span.unwrap();
        assert!(span.ended_at > span.started_at, "{ending:?}");
        assert_eq!(row.values.minutes, 1);
    }
}
