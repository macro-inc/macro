use super::*;
use chrono::TimeZone;

fn schedule() -> Schedule {
    Schedule {
        id: Uuid::nil(),
        name: "Work".into(),
        time_zone: chrono_tz::America::New_York,
        weekly: (0..7)
            .map(|day| WeeklyDay {
                day,
                windows: vec![TimeWindow {
                    start: "09:00".into(),
                    end: "12:00".into(),
                }],
            })
            .collect(),
        overrides: vec![],
    }
}
fn event() -> EventType {
    EventType {
        id: Uuid::new_v4(),
        title: "Meeting".into(),
        slug: "meeting".into(),
        description: String::new(),
        duration_minutes: 30,
        location: String::new(),
        google_meet: false,
        enabled: true,
        schedule_id: Uuid::nil(),
        mode: SchedulingMode::Collective,
        hosts: vec!["a".into(), "b".into()],
        before_minutes: 0,
        after_minutes: 0,
        notice_minutes: 0,
        horizon_days: 365,
        interval_minutes: 30,
        daily_limit: None,
        requires_confirmation: false,
        questions: vec![],
    }
}
use uuid::Uuid;
#[test]
fn collective_intersects_and_round_robin_unions_host_availability() {
    let day = NaiveDate::from_ymd_opt(2026, 9, 21).unwrap();
    let now = Utc.with_ymd_and_hms(2026, 9, 20, 0, 0, 0).unwrap();
    let busy = vec![BusyRange {
        host: "a".into(),
        start: Utc.with_ymd_and_hms(2026, 9, 21, 13, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 9, 21, 14, 0, 0).unwrap(),
    }];
    let mut e = event();
    let collective = slots_for_date(&e, &schedule(), day, now, &busy).unwrap();
    assert_eq!(collective.len(), 4);
    e.mode = SchedulingMode::RoundRobin;
    let rr = slots_for_date(&e, &schedule(), day, now, &busy).unwrap();
    assert_eq!(rr.len(), 6);
    assert_eq!(rr[0].hosts, vec!["b"]);
}
#[test]
fn buffers_notice_and_horizon_are_enforced() {
    let day = NaiveDate::from_ymd_opt(2026, 9, 21).unwrap();
    let now = Utc.with_ymd_and_hms(2026, 9, 21, 13, 0, 0).unwrap();
    let mut e = event();
    e.notice_minutes = 60;
    e.before_minutes = 15;
    e.after_minutes = 15;
    let busy = vec![BusyRange {
        host: "a".into(),
        start: Utc.with_ymd_and_hms(2026, 9, 21, 14, 30, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 9, 21, 15, 0, 0).unwrap(),
    }];
    let slots = slots_for_date(&e, &schedule(), day, now, &busy).unwrap();
    assert_eq!(slots.len(), 1);
    assert_eq!(
        slots[0].starts_at,
        Utc.with_ymd_and_hms(2026, 9, 21, 15, 30, 0).unwrap()
    );
    e.horizon_days = 1;
    assert!(
        slots_for_date(&e, &schedule(), day + Duration::days(3), now, &[])
            .unwrap()
            .is_empty()
    );
}
#[test]
fn empty_override_blocks_an_otherwise_available_day() {
    let day = NaiveDate::from_ymd_opt(2026, 9, 21).unwrap();
    let mut s = schedule();
    s.overrides.push(DateOverride {
        date: day,
        windows: vec![],
    });
    assert!(
        slots_for_date(
            &event(),
            &s,
            day,
            Utc.with_ymd_and_hms(2026, 9, 20, 0, 0, 0).unwrap(),
            &[]
        )
        .unwrap()
        .is_empty()
    );
}
#[test]
fn daylight_saving_keeps_local_hours_and_skips_nonexistent_starts() {
    let mut s = schedule();
    s.weekly[0].windows = vec![TimeWindow {
        start: "01:00".into(),
        end: "04:00".into(),
    }];
    let day = NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
    let slots = slots_for_date(
        &event(),
        &s,
        day,
        Utc.with_ymd_and_hms(2026, 3, 7, 0, 0, 0).unwrap(),
        &[],
    )
    .unwrap();
    assert_eq!(slots.len(), 4);
    assert!(
        slots
            .iter()
            .all(|s| s.ends_at - s.starts_at == Duration::minutes(30))
    );
    let day = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
    let slots = slots_for_date(
        &event(),
        &s,
        day,
        Utc.with_ymd_and_hms(2026, 10, 31, 0, 0, 0).unwrap(),
        &[],
    )
    .unwrap();
    assert_eq!(slots.len(), 4); // ambiguous 1:00/1:30 are never silently assigned an offset
}
#[test]
fn rejects_overlapping_windows_duplicate_days_and_invalid_links() {
    let mut p = Profile {
        id: Uuid::new_v4(),
        name: "Calendar".into(),
        description: String::new(),
        schedules: vec![schedule()],
        default_schedule_id: None,
        event_types: vec![event()],
        revision: 0,
    };
    assert!(validate_profile(&p, true).is_ok());
    p.schedules[0].weekly[0].windows.push(TimeWindow {
        start: "10:00".into(),
        end: "11:00".into(),
    });
    assert!(validate_profile(&p, true).is_err());
    p.schedules[0] = schedule();
    p.schedules[0].weekly[0].day = 1;
    assert!(validate_profile(&p, true).is_err());
    p.schedules[0] = schedule();
    p.event_types[0].slug = "../private".into();
    assert!(validate_profile(&p, true).is_err());
}

#[test]
fn personal_hours_respect_overrides_and_repeated_dst_hour() {
    let mut s = schedule();
    s.time_zone = chrono_tz::America::New_York;
    for day in &mut s.weekly {
        day.windows = vec![TimeWindow {
            start: "01:30".into(),
            end: "02:00".into(),
        }];
    }
    let start = Utc.with_ymd_and_hms(2026, 11, 1, 5, 45, 0).unwrap();
    assert!(schedule_contains(&s, start, start + Duration::minutes(10)).unwrap());
    assert!(!schedule_contains(&s, start, start + Duration::hours(1)).unwrap());
    s.overrides.push(DateOverride {
        date: start.with_timezone(&s.time_zone).date_naive(),
        windows: vec![],
    });
    assert!(!schedule_contains(&s, start, start + Duration::minutes(10)).unwrap());
}
