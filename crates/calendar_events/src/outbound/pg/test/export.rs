use super::*;
use crate::domain::ics::CalendarEventExportAccess;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn event_export_resolves_own_copies_before_channel_shares(pool: PgPool) {
    let author_id = "macro|export-author@example.com";
    let attendee_id = "macro|export-attendee@example.com";
    let member_id = "macro|export-member@example.com";
    let former_id = "macro|export-former@example.com";
    let stranger_id = "macro|export-stranger@example.com";
    let author_link = insert_link(&pool, author_id).await;
    let attendee_link = insert_link(&pool, attendee_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let author_provider = provider_ids(&repo, author_link).await;
    let attendee_provider = provider_ids(&repo, attendee_link).await;

    let mut author_copy = timed_upsert(
        author_id,
        author_link,
        author_provider,
        "export@example.com",
        "Offsite",
        1,
    );
    // Longer than the mention preview truncates to: the export carries it whole.
    let description = "a".repeat(MENTION_PREVIEW_DESCRIPTION_MAX_CHARS as usize + 10);
    author_copy.event.description = Some(description.clone());
    let recurrence_lines = author_copy.event.recurrence_lines.clone();
    let shared_event_id = author_copy.event.id;
    repo.upsert_event_fixture(author_copy).await.unwrap();
    let attendee_copy = timed_upsert(
        attendee_id,
        attendee_link,
        attendee_provider,
        "export@example.com",
        "Offsite, my copy",
        1,
    );
    repo.upsert_event_fixture(attendee_copy).await.unwrap();
    let mut private_copy = timed_upsert(
        author_id,
        author_link,
        author_provider,
        "export-private@example.com",
        "Private",
        1,
    );
    private_copy.event.visibility = EventVisibility::Private;
    let private_event_id = private_copy.event.id;
    repo.upsert_event_fixture(private_copy).await.unwrap();

    let channel_id = insert_channel(
        &pool,
        author_id,
        &[author_id, attendee_id, member_id, former_id],
    )
    .await;
    sqlx::query(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(former_id)
    .execute(&pool)
    .await
    .unwrap();
    share_with_channel(&pool, shared_event_id, channel_id).await;
    share_with_channel(&pool, private_event_id, channel_id).await;

    let shared = repo
        .event_export(member_id, shared_event_id)
        .await
        .unwrap()
        .expect("a channel member sees the shared event");
    assert_eq!(shared.access, CalendarEventExportAccess::ChannelShared);
    assert_eq!(shared.owner_id, author_id);
    assert_eq!(shared.event_type, EventType::Default);
    assert_eq!(shared.ical_uid, "export@example.com");
    assert_eq!(shared.title, "Offsite");
    assert_eq!(shared.description.as_deref(), Some(description.as_str()));
    assert_eq!(shared.recurrence_lines, recurrence_lines);
    assert_eq!(
        shared.organizer_email.as_deref(),
        Some("organizer@example.com")
    );

    // Anyone holding a projection of the meeting exports their own copy.
    let own = repo
        .event_export(attendee_id, shared_event_id)
        .await
        .unwrap()
        .expect("an attendee sees their own copy");
    assert_eq!(own.access, CalendarEventExportAccess::OwnCopy);
    assert_eq!(own.owner_id, attendee_id);
    assert_eq!(own.title, "Offsite, my copy");
    let authored = repo
        .event_export(author_id, shared_event_id)
        .await
        .unwrap()
        .expect("the author sees their own copy");
    assert_eq!(authored.access, CalendarEventExportAccess::OwnCopy);
    assert_eq!(authored.title, "Offsite");

    // Private events stay hidden despite the grant; people who left the
    // channel and outsiders see nothing.
    for (requester, event_id) in [
        (member_id, private_event_id),
        (former_id, shared_event_id),
        (stranger_id, shared_event_id),
    ] {
        assert_eq!(
            repo.event_export(requester, event_id).await.unwrap(),
            None,
            "{requester}"
        );
    }

    sqlx::query("UPDATE calendar_events SET status = 'cancelled' WHERE id = $1")
        .bind(shared_event_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        repo.event_export(member_id, shared_event_id).await.unwrap(),
        None
    );
}
