use super::*;
use crate::domain::models::{AutomaticDeclinePolicy, EventStart, OutOfOfficeProperties};

fn declining(message: &str) -> AutomaticDeclinePolicy {
    AutomaticDeclinePolicy {
        id: Uuid::now_v7(),
        enabled_at: Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap(),
        properties: OutOfOfficeProperties {
            decline_message: Some(message.to_string()),
            ..OutOfOfficeProperties::default()
        },
    }
}

/// Postgres text and `jsonb` cannot hold U+0000, so a provider event carrying
/// one in its text, its decline message or its raw payload would fail its
/// write on every retry. It is written with the NUL characters removed, and a
/// later sync of the same provider event finds it unchanged.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_with_nul_characters_is_written_without_them(pool: PgPool) {
    let owner_id = "macro|calendar-nul@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    repo.apply_google_grant(
        link_id,
        complete_grant(),
        CalendarGrantIntent::CalendarRequested,
    )
    .await
    .unwrap();
    let provider = provider_ids(&repo, link_id).await;
    let mut upsert = timed_upsert(
        owner_id,
        link_id,
        provider,
        "nul@example.com",
        "Quarterly\0 review",
        1,
    );
    upsert.event.description = Some("Agenda\0 attached".to_string());
    upsert.event.location = Some("Room\0 2".to_string());
    upsert.event.attendees[0].display_name = Some("Gu\0est".to_string());
    let edited_start = Utc.with_ymd_and_hms(2026, 7, 25, 14, 0, 0).unwrap();
    let recurrence_id = edited_start.to_rfc3339();
    upsert.occurrences[1].recurrence_id = Some(recurrence_id.clone());
    upsert.overrides = vec![CalendarEventOverride {
        reminders: None,
        automatic_decline: Some(declining("Away\0 that day")),
        visibility: None,
        transparency: None,
        sequence: None,
        source_updated_at: None,
        recurrence_id: recurrence_id.clone(),
        original_time: EventStart::Timed(edited_start),
        time: EventTime::Timed {
            starts_at: edited_start,
            ends_at: edited_start + Duration::hours(1),
            time_zone: Some("UTC".to_string()),
        },
        title: Some("Moved\0 review".to_string()),
        description: None,
        location: None,
        status: None,
        attendees: None,
    }];
    let CalendarEventSource::Google(source) = &mut upsert.source else {
        unreachable!("timed_upsert builds a Google source");
    };
    source.automatic_decline = Some(declining("Out\0 of office"));
    source.raw_payload = serde_json::json!({
        "summary": "Quarterly\u{0} review",
        "extendedProperties": { "private": { "no\u{0}te": ["a\u{0}b"] } },
    });

    let outcome = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert.clone()))
        .await
        .unwrap();
    assert_eq!(outcome.change, CalendarEventChange::Created);
    let event_id = outcome.event_id;

    let stored = sqlx::query!(
        r#"
        SELECT event.title, event.description, event.location,
               source.raw_payload, source.normalized_payload,
               source.automatic_decline->'properties'->>'declineMessage' AS decline_message
        FROM calendar_events event
        JOIN calendar_event_sources source ON source.event_id = event.id
        WHERE event.id = $1
        "#,
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.title, "Quarterly review");
    assert_eq!(stored.description.as_deref(), Some("Agenda attached"));
    assert_eq!(stored.location.as_deref(), Some("Room 2"));
    assert_eq!(stored.decline_message.as_deref(), Some("Out of office"));
    assert_eq!(
        stored.raw_payload,
        serde_json::json!({
            "summary": "Quarterly review",
            "extendedProperties": { "private": { "note": ["ab"] } },
        })
    );
    assert!(!stored.normalized_payload.to_string().contains("\\u0000"));
    let attendee = sqlx::query_scalar!(
        "SELECT display_name FROM calendar_event_attendees WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(attendee.as_deref(), Some("Guest"));
    let stored_override = sqlx::query!(
        r#"
        SELECT title, automatic_decline->'properties'->>'declineMessage' AS decline_message
        FROM calendar_event_overrides
        WHERE event_id = $1 AND recurrence_id = $2
        "#,
        event_id,
        recurrence_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_override.title.as_deref(), Some("Moved review"));
    assert_eq!(
        stored_override.decline_message.as_deref(),
        Some("Away that day")
    );

    let resynced = repo
        .upsert_event(CalendarEventWrite::Fixture(upsert))
        .await
        .unwrap();
    assert_eq!(
        resynced.change,
        CalendarEventChange::Unchanged,
        "the provider's copy, still carrying its NULs, matches what was stored"
    );
}
