use super::*;

fn moved_override(
    original_start: DateTime<Utc>,
    starts_at: DateTime<Utc>,
) -> CalendarEventOverride {
    CalendarEventOverride {
        reminders: None,
        automatic_decline: None,
        visibility: None,
        transparency: None,
        sequence: None,
        source_updated_at: None,
        recurrence_id: original_start.to_rfc3339(),
        original_time: EventStart::Timed(original_start),
        time: EventTime::Timed {
            starts_at,
            ends_at: starts_at + Duration::hours(1),
            time_zone: Some("UTC".to_string()),
        },
        title: Some("Edited title".to_string()),
        description: None,
        location: None,
        status: None,
        attendees: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn event_details_read_the_series_or_one_occurrence(pool: PgPool) {
    let owner_id = "macro|calendar-details@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool);
    let provider = provider_ids(&repo, link_id).await;
    let mut upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "details@example.com",
        "Series title",
        1,
    );
    upsert.event.description = Some("Agenda".to_string());
    upsert.event.conference_url = Some("https://meet.google.com/abc-defg-hij".to_string());
    let series_time = upsert.event.time.clone();
    // The second occurrence moved an hour later; the instance Google lists
    // carries the moved time.
    let second_start = Utc.with_ymd_and_hms(2026, 7, 25, 14, 0, 0).unwrap();
    let second_moved = second_start + Duration::hours(1);
    upsert.occurrences[1].recurrence_id = Some(second_start.to_rfc3339());
    upsert.occurrences[1].time = moved_override(second_start, second_moved).time;
    // A later exception sits outside the materialized occurrences.
    let later_start = Utc.with_ymd_and_hms(2026, 9, 1, 14, 0, 0).unwrap();
    let later_moved = later_start + Duration::hours(2);
    upsert.overrides = vec![
        moved_override(second_start, second_moved),
        moved_override(later_start, later_moved),
    ];
    let event_id = upsert.event.id;
    repo.upsert_event_fixture(upsert).await.unwrap();

    let series = repo
        .get_event_details(event_id, None)
        .await
        .unwrap()
        .expect("the event exists");
    assert_eq!(
        series,
        EventDetails {
            title: "Series title".to_string(),
            description: Some("Agenda".to_string()),
            location: None,
            visibility: EventVisibility::Default,
            time: Some(series_time),
            recurrence_lines: vec!["RRULE:FREQ=DAILY;COUNT=2".to_string()],
            has_conference: true,
        }
    );

    let second = repo
        .get_event_details(event_id, Some(&second_start.to_rfc3339()))
        .await
        .unwrap()
        .expect("the event exists");
    assert_eq!(second.title, "Edited title");
    assert_eq!(
        second.description.as_deref(),
        Some("Agenda"),
        "content the exception leaves alone is the series'"
    );
    assert_eq!(
        second.time,
        Some(moved_override(second_start, second_moved).time)
    );

    let later = repo
        .get_event_details(event_id, Some(&later_start.to_rfc3339()))
        .await
        .unwrap()
        .expect("the event exists");
    assert_eq!(
        later.time,
        Some(moved_override(later_start, later_moved).time)
    );

    let unknown_occurrence = repo
        .get_event_details(event_id, Some("2027-01-01T14:00:00+00:00"))
        .await
        .unwrap()
        .expect("the event exists");
    assert_eq!(unknown_occurrence.title, "Series title");
    assert_eq!(
        unknown_occurrence.time, None,
        "an occurrence outside the stored window has no known time"
    );

    assert_eq!(
        repo.get_event_details(Uuid::now_v7(), None).await.unwrap(),
        None
    );
}
