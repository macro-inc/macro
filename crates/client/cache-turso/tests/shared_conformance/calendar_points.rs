use super::*;

const START_MS: i64 = 1_791_158_400_000;

fn timed_record(start: i64, end: i64) -> Record {
    let instant = |millis| {
        chrono::DateTime::from_timestamp_millis(millis)
            .unwrap()
            .to_rfc3339()
    };
    occurrence(
        "points",
        "point-link",
        &[
            ("__typename", "GraphqlTimedEventTime"),
            ("startsAt", &instant(start)),
            ("endsAt", &instant(end)),
        ],
    )
}

fn point_range() -> CalendarRangeRequest {
    CalendarRangeRequest {
        start_ms: START_MS,
        end_ms: START_MS + 1_000,
        start_day: 20_731,
        end_day: 20_732,
        event_key: None,
    }
}

async fn point_contract<F: BackendFactory>() {
    let (mut factory, mut storage) = F::create();
    let point_key = |name: &str| key(&format!("GraphqlCalendarOccurrence:points:{name}"));
    let entries = [
        ("before", START_MS - 1, START_MS - 1),
        ("left", START_MS, START_MS),
        ("inside", START_MS + 500, START_MS + 500),
        ("right", START_MS + 1_000, START_MS + 1_000),
        ("duration", START_MS + 100, START_MS + 200),
        ("reversed", START_MS + 200, START_MS + 100),
    ]
    .into_iter()
    .map(|(name, start, end)| (point_key(name), timed_record(start, end)))
    .chain([
        (
            point_key("all-day-zero"),
            occurrence(
                "points",
                "point-link",
                &[
                    ("__typename", "GraphqlAllDayEventTime"),
                    ("startDate", "2026-10-05"),
                    ("endDate", "2026-10-05"),
                ],
            ),
        ),
        (
            point_key("all-day-reversed"),
            occurrence(
                "points",
                "point-link",
                &[
                    ("__typename", "GraphqlAllDayEventTime"),
                    ("startDate", "2026-10-06"),
                    ("endDate", "2026-10-05"),
                ],
            ),
        ),
    ])
    .collect();
    storage.put_batch(entries).await.unwrap();
    storage
        .calendar_commit(&CalendarCommit {
            coverage: point_range().spans().to_vec(),
            freshness: Some(CalendarFreshness::Fresh),
            ..CalendarCommit::default()
        })
        .await
        .unwrap();
    let mut storage = factory.reopen(storage);
    for event_key in [None, Some(key("GraphqlCalendarEvent:points"))] {
        let mut request = point_range();
        request.event_key = event_key;
        let snapshot = storage.query_calendar_ranges(&request).await.unwrap();
        let mut keys = snapshot
            .rows
            .iter()
            .map(|row| row.record_key.clone())
            .collect::<Vec<_>>();
        keys.sort();
        assert_eq!(
            keys,
            [
                point_key("duration"),
                point_key("inside"),
                point_key("left")
            ]
        );
        assert_eq!(snapshot.coverage, point_range().spans());
        assert_eq!(snapshot.sync.freshness, CalendarFreshness::Fresh);
        for row in snapshot
            .rows
            .iter()
            .filter(|row| row.record_key != point_key("duration"))
        {
            assert_eq!(row.span.start, row.span.end);
        }
        request.start_ms += 100;
        request.end_ms = request.start_ms;
        request.end_day = request.start_day;
        assert!(
            storage
                .query_calendar_ranges(&request)
                .await
                .unwrap()
                .rows
                .is_empty(),
            "empty viewports read sync state only"
        );
    }

    let mut middle = point_range();
    middle.start_ms += 150;
    middle.end_ms = START_MS + 190;
    middle.end_day = middle.start_day;
    assert_eq!(
        storage
            .query_calendar_ranges(&middle)
            .await
            .unwrap()
            .rows
            .len(),
        1
    );
    storage
        .put_batch(vec![(
            point_key("duration"),
            timed_record(START_MS + 100, START_MS + 100),
        )])
        .await
        .unwrap();
    assert!(
        storage
            .query_calendar_ranges(&middle)
            .await
            .unwrap()
            .rows
            .is_empty(),
        "a positive-to-point replacement removes the old occupied duration"
    );
    let at_point = CalendarRangeRequest {
        start_ms: START_MS + 100,
        end_ms: START_MS + 101,
        ..middle.clone()
    };
    let snapshot = storage.query_calendar_ranges(&at_point).await.unwrap();
    assert_eq!(snapshot.rows.len(), 1);
    assert_eq!(snapshot.rows[0].record_key, point_key("duration"));
    assert_eq!(snapshot.rows[0].span.start, snapshot.rows[0].span.end);
    storage
        .put_batch(vec![(
            point_key("duration"),
            timed_record(START_MS + 100, START_MS + 300),
        )])
        .await
        .unwrap();
    let storage = factory.reopen(storage);
    let snapshot = storage.query_calendar_ranges(&middle).await.unwrap();
    assert_eq!(snapshot.rows.len(), 1);
    assert_eq!(snapshot.rows[0].record_key, point_key("duration"));
    assert_eq!(snapshot.rows[0].span.end, START_MS + 300);
    factory.finish(storage);
}

#[test]
fn in_memory_points_follow_the_calendar_storage_contract() {
    block_on(point_contract::<InMemoryFactory>());
}

#[test]
fn turso_points_follow_the_calendar_storage_contract() {
    block_on(point_contract::<TursoFactory>());
}
