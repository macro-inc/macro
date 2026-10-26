//! Events Google says a calendar organizes: the inbox that can write that
//! calendar organizes them, whichever of its copies it holds.
use super::*;

/// The id Google gives a secondary calendar, which it names as the organizer
/// of the events made on it.
const SECONDARY: &str = "c_0123abcd@group.calendar.google.com";

fn secondary_calendar(provider_calendar_id: &str, access_role: &str) -> ProviderCalendar {
    ProviderCalendar {
        provider_calendar_id: provider_calendar_id.to_string(),
        name: "Personal".to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some(access_role.to_string()),
        is_primary: false,
        is_selected: true,
        default_reminders: Vec::new(),
    }
}

/// One copy of an event organized by `organizer` that lists the inbox's own
/// address as its guest, as Macro wrote events on secondary calendars
/// before October 2026.
fn copy_of(
    owner_id: &str,
    link_id: Uuid,
    provider: (Uuid, Uuid),
    organizer: &str,
    inbox_email: &str,
) -> CalendarEventUpsert {
    let mut copy = timed_upsert(
        owner_id,
        link_id,
        provider,
        "made-on-secondary@example.com",
        "Focus time",
        1,
    );
    copy.event.organizer_email = Some(organizer.to_string());
    copy.event.is_read_only = false;
    copy.event.attendees[0].email = inbox_email.to_string();
    copy
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owned_inboxes_carry_the_calendars_each_can_write(pool: PgPool) {
    let owner_id = "macro|organizer-calendar-owned@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, _) = grant_and_provider_ids(&repo, link_id).await;
    repo.upsert_calendar_fixture(account_id, secondary_calendar(SECONDARY, "owner"))
        .await
        .unwrap();
    repo.upsert_calendar_fixture(
        account_id,
        secondary_calendar("en.usa#holiday@group.v.calendar.google.com", "reader"),
    )
    .await
    .unwrap();
    let removed = repo
        .upsert_calendar_fixture(
            account_id,
            secondary_calendar("c_removed@group.calendar.google.com", "owner"),
        )
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendars SET is_deleted = true WHERE id = $1",
        removed
    )
    .execute(&pool)
    .await
    .unwrap();

    let inboxes = repo.owned_inboxes(owner_id).await.unwrap();

    assert_eq!(inboxes.len(), 1);
    let mut writable = inboxes[0].writable_calendar_ids.clone();
    writable.sort();
    assert_eq!(writable, [SECONDARY, "primary"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_invitation_from_a_secondary_calendar_names_the_organizers_copy(pool: PgPool) {
    let owner_id = "macro|organizer-calendar-target@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let inbox_email = link_email(&pool, link_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary_id) = grant_and_provider_ids(&repo, link_id).await;
    let secondary_id = repo
        .upsert_calendar_fixture(account_id, secondary_calendar(SECONDARY, "owner"))
        .await
        .unwrap();
    let event_id = repo
        .upsert_event(CalendarEventWrite::UserMutation(copy_of(
            owner_id,
            link_id,
            (account_id, secondary_id),
            SECONDARY,
            &inbox_email,
        )))
        .await
        .unwrap()
        .event_id;
    // Google invites the inbox's primary calendar, whose copy shares the
    // entity and becomes canonical.
    repo.upsert_event(CalendarEventWrite::UserMutation(copy_of(
        owner_id,
        link_id,
        (account_id, primary_id),
        SECONDARY,
        &inbox_email,
    )))
    .await
    .unwrap();

    let invitation = repo
        .get_event_mutation_target(owner_id, event_id, None)
        .await
        .unwrap()
        .expect("the owner may address their invitation");
    let organizer_copy = repo
        .get_event_mutation_target(owner_id, event_id, Some(secondary_id))
        .await
        .unwrap()
        .expect("the owner may address the organizer's copy");

    assert_eq!(invitation.calendar_id, primary_id);
    assert_eq!(invitation.organizer_copy_calendar_id, Some(secondary_id));
    assert_eq!(organizer_copy.organizer_copy_calendar_id, None);
    assert_eq!(
        repo.meeting_copies(owner_id, event_id)
            .await
            .unwrap()
            .iter()
            .map(|copy| copy.organizes)
            .collect::<Vec<_>>(),
        [true]
    );
    let previews = repo
        .mention_previews(
            owner_id,
            vec![CalendarMentionRequestItem {
                event_id,
                occurrence_key: None,
            }],
            Utc.with_ymd_and_hms(2026, 7, 23, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();
    let CalendarMentionPreview::Accessible(preview) = &previews[0] else {
        panic!(
            "the owner's preview should be accessible: {:?}",
            previews[0]
        );
    };
    assert_eq!(preview.viewer_copy, Some(CalendarMentionViewerCopy::Event));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_calendar_the_inbox_only_reads_lends_its_copy_nothing(pool: PgPool) {
    let owner_id = "macro|organizer-calendar-reader@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let inbox_email = link_email(&pool, link_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary_id) = grant_and_provider_ids(&repo, link_id).await;
    let shared_id = repo
        .upsert_calendar_fixture(account_id, secondary_calendar(SECONDARY, "reader"))
        .await
        .unwrap();
    let event_id = repo
        .upsert_event(CalendarEventWrite::UserMutation(copy_of(
            owner_id,
            link_id,
            (account_id, primary_id),
            SECONDARY,
            &inbox_email,
        )))
        .await
        .unwrap()
        .event_id;
    repo.upsert_event(CalendarEventWrite::UserMutation(copy_of(
        owner_id,
        link_id,
        (account_id, shared_id),
        SECONDARY,
        &inbox_email,
    )))
    .await
    .unwrap();

    let invitation = repo
        .get_event_mutation_target(owner_id, event_id, None)
        .await
        .unwrap()
        .expect("the owner may address their invitation");

    assert_eq!(invitation.organizer_copy_calendar_id, None);
    assert_eq!(
        repo.meeting_copies(owner_id, event_id)
            .await
            .unwrap()
            .iter()
            .map(|copy| copy.organizes)
            .collect::<Vec<_>>(),
        [false]
    );
}
