use super::*;
use crate::domain::notes::{NoteRepository, NoteTarget};
use crate::outbound::pg_notes::PgNoteRepository;
use entity_access::{
    domain::{models::AccessLevel, ports::AccessRepository},
    outbound::PgAccessRepository,
};
use macro_user_id::user_id::MacroUserIdStr;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_one_time_meeting_keeps_its_notes_after_a_provider_reschedule(pool: PgPool) {
    let owner = "macro|rescheduled-note@example.com";
    let viewer = "macro|rescheduled-note-viewer@example.com";
    for user in [owner, viewer] {
        insert_user(&pool, user).await;
    }
    let calendar = PgCalendarRepository::new(pool.clone());
    let link = insert_link(&pool, owner).await;
    let mut event = timed_upsert(
        owner,
        link,
        provider_ids(&calendar, link).await,
        "one-time-note",
        "Planning",
        1,
    );
    event.event.recurrence_lines.clear();
    event.occurrences.truncate(1);
    let original = NoteTarget {
        event_id: event.event.id,
        occurrence_key: event.occurrences[0].occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(event.clone()).await.unwrap();
    let channel = insert_channel(&pool, owner, &[owner, viewer]).await;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'calendar_event', $2, 'channel', 'view')", original.event_id, channel.to_string()).execute(&pool).await.unwrap();
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        "INSERT INTO \"Document\" (id, name, owner, \"fileType\") VALUES ($1, 'Notes', $2, 'md')",
        document,
        owner
    )
    .execute(&pool)
    .await
    .unwrap();
    let notes = PgNoteRepository::new(pool.clone());
    notes.link(owner, &original, &document, None).await.unwrap();

    let starts_at = Utc.with_ymd_and_hms(2026, 7, 26, 16, 0, 0).unwrap();
    event.event.sequence += 1;
    event.event.updated_at += Duration::minutes(1);
    event.event.time = EventTime::Timed {
        starts_at,
        ends_at: starts_at + Duration::hours(1),
        time_zone: Some("UTC".into()),
    };
    event.occurrences[0].time = event.event.time.clone();
    event.occurrences[0].occurrence_key = starts_at.to_rfc3339();
    let moved = NoteTarget {
        event_id: original.event_id,
        occurrence_key: event.occurrences[0].occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(event).await.unwrap();

    assert_eq!(notes.list(viewer, &moved).await.unwrap().len(), 1);
    let viewer_id = MacroUserIdStr::parse_from_str(viewer).unwrap();
    assert_eq!(
        PgAccessRepository::new(pool.clone())
            .get_document_access(&document, Some(&viewer_id))
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    assert_eq!(
        notes.document_links(owner, &document).await.unwrap()[0].occurrence_key,
        "single"
    );
    // A previously returned handle remains able to revoke after the move.
    notes.unlink(&original, &document).await.unwrap();
    assert!(notes.list(viewer, &moved).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn converting_a_series_to_one_time_does_not_revive_another_instances_grants(pool: PgPool) {
    let owner = "macro|converted-note@example.com";
    let viewer = "macro|converted-note-viewer@example.com";
    for user in [owner, viewer] {
        insert_user(&pool, user).await;
    }
    let calendar = PgCalendarRepository::new(pool.clone());
    let link = insert_link(&pool, owner).await;
    let mut event = timed_upsert(
        owner,
        link,
        provider_ids(&calendar, link).await,
        "converted-note",
        "Planning",
        1,
    );
    let original = NoteTarget {
        event_id: event.event.id,
        occurrence_key: event.occurrences[0].occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(event.clone()).await.unwrap();
    let channel = insert_channel(&pool, owner, &[owner, viewer]).await;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'calendar_event', $2, 'channel', 'view')", original.event_id, channel.to_string()).execute(&pool).await.unwrap();
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        "INSERT INTO \"Document\" (id, name, owner, \"fileType\") VALUES ($1, 'Notes', $2, 'md')",
        document,
        owner
    )
    .execute(&pool)
    .await
    .unwrap();
    let notes = PgNoteRepository::new(pool.clone());
    notes.link(owner, &original, &document, None).await.unwrap();
    event.event.recurrence_lines.clear();
    event.occurrences.remove(0);
    event.event.time = event.occurrences[0].time.clone();
    event.event.sequence += 1;
    event.event.updated_at += Duration::minutes(1);
    calendar.upsert_event_fixture(event).await.unwrap();
    let viewer_id = MacroUserIdStr::parse_from_str(viewer).unwrap();
    assert_eq!(
        PgAccessRepository::new(pool.clone())
            .get_document_access(&document, Some(&viewer_id))
            .await
            .unwrap(),
        None
    );
    notes.unlink(&original, &document).await.unwrap();
    assert!(
        notes
            .document_links(owner, &document)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notes_follow_real_guests_reject_forged_copies_and_revoke_without_deleting_documents(
    pool: PgPool,
) {
    let owner = "macro|notes-owner@example.com";
    let guest = "macro|notes-guest@example.com";
    let stranger = "macro|notes-stranger@example.com";
    for user in [owner, guest, stranger] {
        insert_user(&pool, user).await;
    }
    let calendar = PgCalendarRepository::new(pool.clone());
    let notes = PgNoteRepository::new(pool.clone());
    let access = PgAccessRepository::new(pool.clone());
    let owner_link = insert_link(&pool, owner).await;
    let guest_link = insert_link(&pool, guest).await;
    let stranger_link = insert_link(&pool, stranger).await;
    sqlx::query!(
        "UPDATE email_links SET email_address = 'organizer@example.com' WHERE id = $1",
        owner_link
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_links SET email_address = 'guest@example.com' WHERE id = $1",
        guest_link
    )
    .execute(&pool)
    .await
    .unwrap();
    let original = timed_upsert(
        owner,
        owner_link,
        provider_ids(&calendar, owner_link).await,
        "notes-meeting",
        "Planning",
        1,
    );
    let target = NoteTarget {
        event_id: original.event.id,
        occurrence_key: original.occurrences[0].occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(original).await.unwrap();
    let guest_copy = timed_upsert(
        guest,
        guest_link,
        provider_ids(&calendar, guest_link).await,
        "notes-meeting",
        "Planning",
        1,
    );
    let guest_event = guest_copy.event.id;
    calendar.upsert_event_fixture(guest_copy).await.unwrap();
    let forged = timed_upsert(
        stranger,
        stranger_link,
        provider_ids(&calendar, stranger_link).await,
        "notes-meeting",
        "Forged",
        1,
    );
    let forged_target = NoteTarget {
        event_id: forged.event.id,
        occurrence_key: target.occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(forged).await.unwrap();
    let document = Uuid::now_v7().to_string();
    sqlx::query!("INSERT INTO \"Document\" (id, name, owner, \"fileType\") VALUES ($1, 'Meeting notes', $2, 'md')", document, owner).execute(&pool).await.unwrap();
    notes.link(owner, &target, &document, None).await.unwrap();
    notes.link(owner, &target, &document, None).await.unwrap();
    assert_eq!(notes.list(guest, &target).await.unwrap().len(), 1);
    let guest_id = MacroUserIdStr::parse_from_str(guest).unwrap();
    let stranger_id = MacroUserIdStr::parse_from_str(stranger).unwrap();
    assert_eq!(
        access
            .get_document_access(&document, Some(&guest_id))
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    assert_eq!(
        access
            .get_document_access(&document, Some(&stranger_id))
            .await
            .unwrap(),
        None
    );
    assert!(
        notes
            .list(stranger, &forged_target)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        access.get_document_access(&document, None).await.unwrap(),
        None
    );
    let injected = Uuid::now_v7().to_string();
    sqlx::query!("INSERT INTO \"Document\" (id, name, owner, \"fileType\") VALUES ($1, 'Injected notes', $2, 'md')", injected, stranger).execute(&pool).await.unwrap();
    notes
        .link(stranger, &forged_target, &injected, None)
        .await
        .unwrap();
    let owner_id = MacroUserIdStr::parse_from_str(owner).unwrap();
    assert_eq!(
        access
            .get_document_access(&injected, Some(&owner_id))
            .await
            .unwrap(),
        None
    );
    assert_eq!(notes.list(owner, &target).await.unwrap().len(), 1);
    let fake_channel = insert_channel(&pool, stranger, &[stranger, owner]).await;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'calendar_event', $2, 'channel', 'view')", forged_target.event_id, fake_channel.to_string()).execute(&pool).await.unwrap();
    assert!(notes.visible(owner, &forged_target).await.unwrap());
    assert_eq!(notes.list(owner, &target).await.unwrap().len(), 1);
    let another = NoteTarget {
        event_id: target.event_id,
        occurrence_key: "2026-07-25T14:00:00+00:00".into(),
    };
    assert!(notes.list(guest, &another).await.unwrap().is_empty());

    sqlx::query!(
        "UPDATE calendar_events SET is_snapshot = true WHERE id = $1",
        guest_event
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        access
            .get_document_access(&document, Some(&guest_id))
            .await
            .unwrap(),
        None
    );
    sqlx::query!(
        "UPDATE calendar_events SET is_snapshot = false WHERE id = $1",
        guest_event
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO calendar_event_overrides (event_id, recurrence_id, original_starts_at, starts_at, ends_at, attendees_overridden) SELECT event_id, occurrence_key, starts_at, starts_at, ends_at, true FROM calendar_event_occurrences WHERE event_id = $1 AND occurrence_key = $2", target.event_id, target.occurrence_key).execute(&pool).await.unwrap();
    sqlx::query!("UPDATE calendar_event_occurrences SET recurrence_id = occurrence_key WHERE event_id = $1 AND occurrence_key = $2", target.event_id, target.occurrence_key).execute(&pool).await.unwrap();
    assert_eq!(
        access
            .get_document_access(&document, Some(&guest_id))
            .await
            .unwrap(),
        None
    );
    sqlx::query!(
        "UPDATE calendar_event_overrides SET attendees_overridden = false WHERE event_id = $1",
        target.event_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        access
            .get_document_access(&document, Some(&guest_id))
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    sqlx::query!(
        "DELETE FROM calendar_event_attendees WHERE event_id = $1",
        target.event_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        access
            .get_document_access(&document, Some(&guest_id))
            .await
            .unwrap(),
        None
    );

    // Provider sync removes cancelled instances instead of retaining tombstones.
    sqlx::query!(
        "DELETE FROM calendar_event_occurrences WHERE event_id = $1 AND occurrence_key = $2",
        target.event_id,
        target.occurrence_key
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(!notes.visible(owner, &target).await.unwrap());
    notes.unlink(&target, &document).await.unwrap();
    notes.unlink(&target, &document).await.unwrap();
    assert!(notes.list(owner, &target).await.unwrap().is_empty());
    assert!(notes.is_markdown(&document).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_note_access_observes_membership_and_private_occurrences(pool: PgPool) {
    let owner = "macro|channel-note-owner@example.com";
    let viewer = "macro|channel-note-viewer@example.com";
    for user in [owner, viewer] {
        insert_user(&pool, user).await;
    }
    let calendar = PgCalendarRepository::new(pool.clone());
    let link = insert_link(&pool, owner).await;
    let event = timed_upsert(
        owner,
        link,
        provider_ids(&calendar, link).await,
        "channel-note",
        "Planning",
        1,
    );
    let target = NoteTarget {
        event_id: event.event.id,
        occurrence_key: event.occurrences[0].occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(event).await.unwrap();
    let channel = insert_channel(&pool, owner, &[owner, viewer]).await;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'calendar_event', $2, 'channel', 'view')", target.event_id, channel.to_string()).execute(&pool).await.unwrap();
    let notes = PgNoteRepository::new(pool.clone());
    assert!(notes.visible(viewer, &target).await.unwrap());
    let overrides =
        serde_json::json!([{ "recurrenceId": target.occurrence_key, "visibility": "private" }]);
    sqlx::query!("UPDATE calendar_event_sources SET normalized_payload = jsonb_set(jsonb_set(normalized_payload, '{occurrences,0,recurrenceId}', to_jsonb($2::text)), '{overrides}', $3) WHERE event_id = $1", target.event_id, target.occurrence_key, overrides).execute(&pool).await.unwrap();
    assert!(!notes.visible(viewer, &target).await.unwrap());
    sqlx::query!("UPDATE calendar_event_sources SET normalized_payload = jsonb_set(normalized_payload, '{overrides}', '[]') WHERE event_id = $1", target.event_id).execute(&pool).await.unwrap();
    assert!(notes.visible(viewer, &target).await.unwrap());
    sqlx::query!("UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2", channel, viewer).execute(&pool).await.unwrap();
    assert!(!notes.visible(viewer, &target).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn optional_team_grants_follow_membership_and_leave_other_document_permissions_intact(
    pool: PgPool,
) {
    let owner = "macro|team-note-owner@example.com";
    let teammate = "macro|team-note-viewer@example.com";
    let team = insert_team(&pool, owner, &[owner, teammate]).await;
    let link = insert_link(&pool, owner).await;
    let calendar = PgCalendarRepository::new(pool.clone());
    let event = timed_upsert(
        owner,
        link,
        provider_ids(&calendar, link).await,
        "team-note",
        "Planning",
        1,
    );
    let target = NoteTarget {
        event_id: event.event.id,
        occurrence_key: event.occurrences[0].occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(event).await.unwrap();
    let document = Uuid::now_v7();
    let document_id = document.to_string();
    sqlx::query!(
        "INSERT INTO \"Document\" (id, name, owner, \"fileType\") VALUES ($1, 'Notes', $2, 'md')",
        document_id,
        owner
    )
    .execute(&pool)
    .await
    .unwrap();
    let notes = PgNoteRepository::new(pool.clone());
    let access = PgAccessRepository::new(pool.clone());
    let user = MacroUserIdStr::parse_from_str(teammate).unwrap();
    notes
        .link(owner, &target, &document_id, None)
        .await
        .unwrap();
    assert_eq!(
        access
            .get_document_access(&document_id, Some(&user))
            .await
            .unwrap(),
        None
    );
    notes
        .link(owner, &target, &document_id, Some(team))
        .await
        .unwrap();
    assert_eq!(
        access
            .get_document_access(&document_id, Some(&user))
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    sqlx::query!(
        "UPDATE calendar_events SET status = 'cancelled' WHERE id = $1",
        target.event_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let links = notes.document_links(owner, &document_id).await.unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].event_title, "Unavailable meeting");
    assert_eq!(links[0].team.as_ref().unwrap().id, team);
    assert!(
        notes
            .document_links(teammate, &document_id)
            .await
            .unwrap()
            .is_empty()
    );
    let service = crate::domain::notes::MeetingNotes::new(PgNoteRepository::new(pool.clone()));
    let receipt =
        entity_access::domain::models::EntityAccessReceipt::dangerously_assert_authenticated_user(
            MacroUserIdStr::parse_from_str(owner).unwrap(),
            &document_id,
            entity_access::domain::models::EntityType::Document,
        );
    crate::domain::notes::MeetingNotesService::unlink(&service, receipt, target.clone())
        .await
        .unwrap();
    assert!(
        notes
            .document_links(owner, &document_id)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        access
            .get_document_access(&document_id, Some(&user))
            .await
            .unwrap(),
        None
    );
    sqlx::query!(
        "UPDATE calendar_events SET status = 'confirmed' WHERE id = $1",
        target.event_id
    )
    .execute(&pool)
    .await
    .unwrap();
    notes
        .link(owner, &target, &document_id, Some(team))
        .await
        .unwrap();
    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", teammate)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        access
            .get_document_access(&document_id, Some(&user))
            .await
            .unwrap(),
        None
    );
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'document', $2, 'user', 'edit')", document, teammate).execute(&pool).await.unwrap();
    notes.unlink(&target, &document_id).await.unwrap();
    assert_eq!(
        access
            .get_document_access(&document_id, Some(&user))
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );
    assert!(notes.is_markdown(&document_id).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_detail_access_is_live_and_busy_only_never_reveals_notes(pool: PgPool) {
    let owner = "macro|detail-owner@example.com";
    let viewer = "macro|detail-viewer@example.com";
    insert_team(&pool, owner, &[owner, viewer]).await;
    let calendar = PgCalendarRepository::new(pool.clone());
    let link = insert_link(&pool, owner).await;
    let (account, calendar_id) = provider_ids(&calendar, link).await;
    let event = timed_upsert(
        owner,
        link,
        (account, calendar_id),
        "detail-note",
        "Planning",
        1,
    );
    let target = NoteTarget {
        event_id: event.event.id,
        occurrence_key: event.occurrences[0].occurrence_key.clone(),
    };
    calendar.upsert_event_fixture(event).await.unwrap();
    sqlx::query!(
        "UPDATE calendars SET synced_at=now(), snapshot_normalization_version=1 WHERE id=$1",
        calendar_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendars SET snapshot_normalization_version=1 WHERE id=$1",
        calendar_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status='ready', last_synced_at=now() WHERE id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    let notes = PgNoteRepository::new(pool.clone());
    assert!(!notes.visible(viewer, &target).await.unwrap());
    sqlx::query!(
        "INSERT INTO calendar_team_sharing (user_id, sharing) VALUES ($1, 'all')",
        owner
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(notes.visible(viewer, &target).await.unwrap());
    let document = Uuid::now_v7().to_string();
    sqlx::query!(
        "INSERT INTO \"Document\" (id, name, owner, \"fileType\") VALUES ($1, 'Notes', $2, 'md')",
        document,
        viewer
    )
    .execute(&pool)
    .await
    .unwrap();
    notes.link(viewer, &target, &document, None).await.unwrap();
    assert_eq!(
        notes.document_links(viewer, &document).await.unwrap()[0].event_title,
        "Shared meeting"
    );
    sqlx::query!("UPDATE calendar_event_sources SET normalized_payload = jsonb_set(normalized_payload, '{event,visibility}', '\"private\"') WHERE event_id=$1", target.event_id).execute(&pool).await.unwrap();
    assert!(!notes.visible(viewer, &target).await.unwrap());
    sqlx::query!("UPDATE calendar_event_sources SET normalized_payload = jsonb_set(normalized_payload, '{event,visibility}', '\"default\"') WHERE event_id=$1", target.event_id).execute(&pool).await.unwrap();
    assert!(notes.visible(viewer, &target).await.unwrap());
    sqlx::query!(
        "UPDATE calendar_accounts SET last_synced_at=now()-interval '16 minutes' WHERE id=$1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(!notes.visible(viewer, &target).await.unwrap());
}
