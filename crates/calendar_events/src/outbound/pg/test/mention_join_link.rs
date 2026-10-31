use super::*;
use crate::domain::meeting_links::attach_macro_call;

const CALL_URL: &str = "https://macro.com/app/meet/join/abcdefghijklmnop";

async fn preview(
    repo: &PgCalendarRepository,
    viewer_id: &str,
    event_id: Uuid,
    occurrence_key: Option<String>,
) -> CalendarMentionEvent {
    let previews = repo
        .mention_previews(
            viewer_id,
            vec![CalendarMentionRequestItem {
                event_id,
                occurrence_key,
            }],
            Utc.with_ymd_and_hms(2026, 7, 23, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();
    match previews.into_iter().next() {
        Some(CalendarMentionPreview::Accessible(event)) => *event,
        other => panic!("{viewer_id} should see the event: {other:?}"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_channel_share_previews_the_meeting_without_its_macro_call(pool: PgPool) {
    let organizer_id = "macro|call-organizer@example.com";
    let guest_id = "macro|call-guest@example.com";
    let member_id = "macro|call-member@example.com";
    let organizer_link = insert_link(&pool, organizer_id).await;
    let guest_link = insert_link(&pool, guest_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let organizer_provider = provider_ids(&repo, organizer_link).await;
    let guest_provider = provider_ids(&repo, guest_link).await;
    let (description, location) =
        attach_macro_call(Some("<p>Bring the budget draft</p>"), None, CALL_URL);

    let mut organizer_copy = timed_upsert(
        organizer_id,
        organizer_link,
        organizer_provider,
        "call@example.com",
        "Budget review",
        1,
    );
    organizer_copy.event.description = Some(description.clone());
    organizer_copy.event.location = Some(location.clone());
    let organizer_event_id = organizer_copy.event.id;
    repo.upsert_event_fixture(organizer_copy).await.unwrap();
    let mut guest_copy = timed_upsert(
        guest_id,
        guest_link,
        guest_provider,
        "call@example.com",
        "Budget review",
        1,
    );
    guest_copy.event.description = Some(description.clone());
    guest_copy.event.location = Some(location.clone());
    let guest_event_id = guest_copy.event.id;
    repo.upsert_event_fixture(guest_copy).await.unwrap();

    let channel_id =
        insert_channel(&pool, organizer_id, &[organizer_id, guest_id, member_id]).await;
    share_with_channel(&pool, organizer_event_id, channel_id).await;

    let shared = preview(&repo, member_id, organizer_event_id, None).await;
    assert_eq!(shared.viewer_event_id, None);
    assert_eq!(
        shared.description.as_deref(),
        Some("Bring the budget draft")
    );
    assert_eq!(shared.location, None);

    // The web's Join button reads the link from a holder's preview, so anyone
    // resolving to their own copy keeps it, whichever copy was mentioned.
    let organizer = preview(&repo, organizer_id, organizer_event_id, None).await;
    assert_eq!(organizer.viewer_event_id, Some(organizer_event_id));
    assert_eq!(organizer.description, Some(description.clone()));
    assert_eq!(organizer.location, Some(location.clone()));
    let guest = preview(&repo, guest_id, organizer_event_id, None).await;
    assert_eq!(guest.viewer_event_id, Some(guest_event_id));
    assert_eq!(guest.description, Some(description));
    assert_eq!(guest.location, Some(location));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_channel_share_keeps_a_room_beside_the_macro_call(pool: PgPool) {
    let organizer_id = "macro|room-organizer@example.com";
    let member_id = "macro|room-member@example.com";
    let organizer_link = insert_link(&pool, organizer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, organizer_link).await;
    let (description, location) = attach_macro_call(None, Some("Room 4"), CALL_URL);
    let mut upsert = timed_upsert(
        organizer_id,
        organizer_link,
        provider,
        "room@example.com",
        "Budget review",
        1,
    );
    upsert.event.description = Some(description);
    upsert.event.location = Some(location);
    let event_id = upsert.event.id;
    repo.upsert_event_fixture(upsert).await.unwrap();
    let channel_id = insert_channel(&pool, organizer_id, &[organizer_id, member_id]).await;
    share_with_channel(&pool, event_id, channel_id).await;

    let shared = preview(&repo, member_id, event_id, None).await;
    assert_eq!(shared.description, None);
    assert_eq!(shared.location.as_deref(), Some("Room 4"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_channel_share_previews_an_occurrence_without_its_macro_call(pool: PgPool) {
    let organizer_id = "macro|exception-organizer@example.com";
    let member_id = "macro|exception-member@example.com";
    let organizer_link = insert_link(&pool, organizer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, organizer_link).await;
    let mut upsert = timed_upsert(
        organizer_id,
        organizer_link,
        provider,
        "exception@example.com",
        "Budget review",
        1,
    );
    upsert.event.description = Some("Series agenda".to_string());
    let (description, location) = attach_macro_call(Some("<p>Only this one</p>"), None, CALL_URL);
    let edited_start = Utc.with_ymd_and_hms(2026, 7, 25, 14, 0, 0).unwrap();
    let recurrence_id = edited_start.to_rfc3339();
    upsert.occurrences[1].recurrence_id = Some(recurrence_id.clone());
    upsert.overrides = vec![CalendarEventOverride {
        reminders: None,
        automatic_decline: None,
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
        title: None,
        description: Some(description.clone()),
        location: Some(location.clone()),
        status: None,
        attendees: None,
    }];
    let event_id = upsert.event.id;
    repo.upsert_event_fixture(upsert).await.unwrap();
    let channel_id = insert_channel(&pool, organizer_id, &[organizer_id, member_id]).await;
    share_with_channel(&pool, event_id, channel_id).await;

    let shared = preview(&repo, member_id, event_id, Some(recurrence_id.clone())).await;
    assert_eq!(shared.description.as_deref(), Some("Only this one"));
    assert_eq!(shared.location, None);

    let organizer = preview(&repo, organizer_id, event_id, Some(recurrence_id)).await;
    assert_eq!(organizer.description, Some(description));
    assert_eq!(organizer.location, Some(location));
}

/// The join line closes the description, so a long body puts the preview's
/// cut inside it: past its link, inside its link, and before it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_macro_call_leaves_a_shared_description_whole_before_the_cap(pool: PgPool) {
    let organizer_id = "macro|cap-organizer@example.com";
    let member_id = "macro|cap-member@example.com";
    let organizer_link = insert_link(&pool, organizer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, organizer_link).await;
    let channel_id = insert_channel(&pool, organizer_id, &[organizer_id, member_id]).await;

    for (body_chars, previewed_chars) in [(3_900, 3_900), (3_925, 3_925), (4_100, 4_000)] {
        let body = "a".repeat(body_chars);
        let (description, location) = attach_macro_call(Some(&body), Some("Room 4"), CALL_URL);
        let mut upsert = timed_upsert(
            organizer_id,
            organizer_link,
            provider,
            &format!("cap-{body_chars}@example.com"),
            "Budget review",
            1,
        );
        upsert.event.description = Some(description);
        upsert.event.location = Some(location);
        let event_id = upsert.event.id;
        repo.upsert_event_fixture(upsert).await.unwrap();
        share_with_channel(&pool, event_id, channel_id).await;

        let shared = preview(&repo, member_id, event_id, None).await;
        assert_eq!(
            shared.description,
            Some("a".repeat(previewed_chars)),
            "{body_chars} characters of body"
        );
    }
}
