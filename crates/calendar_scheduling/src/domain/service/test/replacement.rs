use super::*;

#[tokio::test]
async fn replacements_use_the_visitor_date_and_keep_the_booking_snapshot() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let mut p = profile(None);
    p.schedules[0].time_zone = chrono_tz::America::Los_Angeles;
    let mut p = service.save("admin", None, p).await.unwrap();
    let date = request().starts_at.date_naive();
    let start = p.schedules[0]
        .time_zone
        .from_local_datetime(&date.and_hms_opt(9, 0, 0).unwrap())
        .single()
        .unwrap()
        .with_timezone(&Utc);
    let record = service
        .book(
            p.id,
            p.event_types[0].id,
            BookingRequest {
                starts_at: start,
                ..request()
            },
        )
        .await
        .unwrap();
    // Rescheduling must continue to use the saved schedule after the link is removed.
    p.event_types.clear();
    p.schedules[0].time_zone = chrono_tz::UTC;
    service.save("admin", None, p).await.unwrap();
    let zone = chrono_tz::Asia::Tokyo;
    let visitor_date = start.with_timezone(&zone).date_naive();
    let slots = service
        .replacement_slots(record.booking.id, record.token, visitor_date, Some(zone))
        .await
        .unwrap();
    assert_eq!(slots.len(), 16);
    assert!(slots.iter().any(|s| s.starts_at == start));
    assert!(
        slots
            .iter()
            .all(|s| s.starts_at.with_timezone(&zone).date_naive() == visitor_date)
    );
    assert!(slots.iter().all(|s| {
        s.starts_at
            .with_timezone(&record.schedule.time_zone)
            .date_naive()
            == date
    }));
    assert!(
        slots
            .windows(2)
            .all(|pair| pair[0].starts_at < pair[1].starts_at)
    );
    let moved = service
        .reschedule(record.booking.id, record.token, slots[1].starts_at)
        .await
        .unwrap();
    assert_eq!(
        moved.booking.starts_at.with_timezone(&zone).date_naive(),
        visitor_date
    );
    let legacy = service
        .replacement_slots(record.booking.id, record.token, date, None)
        .await
        .unwrap();
    assert_eq!(legacy.len(), 16);
    assert!(matches!(
        service
            .replacement_slots(record.booking.id, Uuid::new_v4(), visitor_date, Some(zone))
            .await,
        Err(Error::NotFound)
    ));
}

#[tokio::test]
async fn replacements_combine_host_dates_and_check_conflicts_after_visitor_midnight() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let mut p = profile(None);
    for day in &mut p.schedules[0].weekly {
        day.windows = vec![TimeWindow {
            start: "00:00".into(),
            end: "23:00".into(),
        }];
    }
    p.event_types[0].duration_minutes = 60;
    let p = service.save("admin", None, p).await.unwrap();
    let record = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let date = record.booking.starts_at.date_naive();
    let zone = chrono_tz::Asia::Tokyo;
    // Tokyo midnight is 15:00 UTC. A candidate at 14:30 overlaps this other booking.
    let conflict_start = date.and_hms_opt(15, 0, 0).unwrap().and_utc();
    service
        .book(
            p.id,
            p.event_types[0].id,
            BookingRequest {
                starts_at: conflict_start,
                ..request()
            },
        )
        .await
        .unwrap();
    let slots = service
        .replacement_slots(record.booking.id, record.token, date, Some(zone))
        .await
        .unwrap();
    assert!(
        slots
            .iter()
            .any(|s| s.starts_at.date_naive() == date.pred_opt().unwrap())
    );
    assert!(slots.iter().any(|s| s.starts_at.date_naive() == date));
    assert!(
        slots
            .iter()
            .all(|s| s.starts_at.with_timezone(&zone).date_naive() == date)
    );
    assert!(
        slots
            .iter()
            .any(|s| s.starts_at == record.booking.starts_at)
    );
    assert!(
        !slots
            .iter()
            .any(|s| s.starts_at == conflict_start - Duration::minutes(30))
    );
}

#[test]
fn visitor_day_bounds_follow_daylight_saving_transitions() {
    let mut schedule = profile(None).schedules.remove(0);
    schedule.time_zone = chrono_tz::America::New_York;
    let (start, end) = day_bounds(&schedule, NaiveDate::from_ymd_opt(2026, 3, 8).unwrap()).unwrap();
    assert_eq!(
        start,
        "2026-03-08T05:00:00Z".parse::<DateTime<Utc>>().unwrap()
    );
    assert_eq!(
        end,
        "2026-03-09T04:00:00Z".parse::<DateTime<Utc>>().unwrap()
    );
    let (start, end) =
        day_bounds(&schedule, NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()).unwrap();
    assert_eq!(
        start,
        "2026-11-01T04:00:00Z".parse::<DateTime<Utc>>().unwrap()
    );
    assert_eq!(
        end,
        "2026-11-02T05:00:00Z".parse::<DateTime<Utc>>().unwrap()
    );
}
