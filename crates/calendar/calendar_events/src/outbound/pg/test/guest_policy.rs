use super::meeting_copies::link_email;
use super::*;

const MEETING: &str = "policy@example.com";

/// The id Google gives a secondary calendar, which it names as the organizer
/// of the events made on it.
const SECONDARY: &str = "c_policy@group.calendar.google.com";

const NO_INVITES: GuestPolicy = GuestPolicy {
    can_modify: false,
    can_invite_others: false,
    can_see_other_guests: true,
};

/// A calendar in `link_id`'s inbox with the id Google gives it: the inbox's
/// address for its primary calendar, or a secondary calendar's id.
async fn calendar(
    repo: &PgCalendarRepository,
    link_id: Uuid,
    provider_calendar_id: &str,
    access_role: &str,
) -> (Uuid, Uuid) {
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let calendar_id = repo
        .upsert_calendar_fixture(
            account_id,
            ProviderCalendar {
                provider_calendar_id: provider_calendar_id.to_string(),
                name: provider_calendar_id.to_string(),
                description: None,
                time_zone: Some("UTC".to_string()),
                color: None,
                access_role: Some(access_role.to_string()),
                is_primary: provider_calendar_id != SECONDARY,
                is_selected: true,
                default_reminders: Vec::new(),
            },
        )
        .await
        .unwrap();
    (account_id, calendar_id)
}

/// A copy of one meeting organized by `organizer`, stored on `provider`.
fn copy_of(
    owner_id: &str,
    link_id: Uuid,
    provider: (Uuid, Uuid),
    organizer: &str,
    policy: GuestPolicy,
    sequence: u32,
) -> CalendarEventUpsert {
    let mut copy = timed_upsert(
        owner_id,
        link_id,
        provider,
        MEETING,
        "Weekly sync",
        sequence,
    );
    copy.event.organizer_email = Some(organizer.to_string());
    copy.event.guest_policy = policy;
    copy.event.title = format!("Weekly sync {sequence}");
    copy
}

/// The entity's switches and the guest policy each of its projections carries.
async fn stored_policy(
    pool: &PgPool,
    event_id: Uuid,
) -> (GuestPolicy, Vec<Option<serde_json::Value>>) {
    let row = sqlx::query!(
        r#"
        SELECT guests_can_modify, guests_can_invite_others, guests_can_see_other_guests
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let projected = sqlx::query_scalar!(
        r#"
        SELECT normalized_payload -> 'event' -> 'guestPolicy'
        FROM calendar_event_sources
        WHERE event_id = $1
        ORDER BY id
        "#,
        event_id,
    )
    .fetch_all(pool)
    .await
    .unwrap();
    (
        GuestPolicy {
            can_modify: row.guests_can_modify,
            can_invite_others: row.guests_can_invite_others,
            can_see_other_guests: row.guests_can_see_other_guests,
        },
        projected,
    )
}

async fn changes_for(pool: &PgPool, link_id: Uuid, event_id: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM calendar_change_log WHERE link_id = $1 AND event_id = $2"#,
        link_id,
        event_id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn no_invites_projection() -> Option<serde_json::Value> {
    Some(serde_json::json!({
        "canModify": false,
        "canInviteOthers": false,
        "canSeeOtherGuests": true,
    }))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_organizers_policy_reaches_every_macro_held_guest_copy(pool: PgPool) {
    let organizer_id = "macro|policy-organizer@example.com";
    let guest_id = "macro|policy-guest@example.com";
    let organizer_link = insert_link(&pool, organizer_id).await;
    let guest_link = insert_link(&pool, guest_id).await;
    let claiming_link = insert_link(&pool, guest_id).await;
    let other_link = insert_link(&pool, guest_id).await;
    let snapshot_link = insert_link(&pool, guest_id).await;
    let organizer = link_email(&pool, organizer_link).await;
    let repo = PgCalendarRepository::new(pool.clone());

    let guest = repo
        .upsert_event_fixture(copy_of(
            guest_id,
            guest_link,
            provider_ids(&repo, guest_link).await,
            &organizer,
            GuestPolicy::default(),
            1,
        ))
        .await
        .unwrap();
    // A guest's copy reporting another policy is not the organizer's: it
    // changes no other copy.
    repo.upsert_event_fixture(copy_of(
        guest_id,
        claiming_link,
        provider_ids(&repo, claiming_link).await,
        &organizer,
        NO_INVITES,
        1,
    ))
    .await
    .unwrap();
    assert_eq!(stored_policy(&pool, guest).await.0, GuestPolicy::default());
    let other = repo
        .upsert_event_fixture(copy_of(
            guest_id,
            other_link,
            provider_ids(&repo, other_link).await,
            "someone-else@example.com",
            GuestPolicy::default(),
            1,
        ))
        .await
        .unwrap();
    let mut snapshot_copy = copy_of(
        guest_id,
        snapshot_link,
        provider_ids(&repo, snapshot_link).await,
        &organizer,
        GuestPolicy::default(),
        1,
    );
    snapshot_copy.event.is_snapshot = true;
    let snapshot = repo.upsert_event_fixture(snapshot_copy).await.unwrap();
    let changes_before = changes_for(&pool, guest_link, guest).await;

    // Google names the organizer's primary calendar by their address.
    let organized = repo
        .upsert_event(CalendarEventWrite::Fixture(copy_of(
            organizer_id,
            organizer_link,
            calendar(&repo, organizer_link, &organizer, "owner").await,
            &organizer,
            NO_INVITES,
            1,
        )))
        .await
        .unwrap();

    assert_eq!(stored_policy(&pool, organized.event_id).await.0, NO_INVITES);
    assert_eq!(
        stored_policy(&pool, guest).await,
        (NO_INVITES, vec![no_invites_projection()])
    );
    assert!(
        organized
            .aligned_copies
            .iter()
            .any(|copy| copy.event_id == guest && copy.email_link_id == guest_link),
        "{:?}",
        organized.aligned_copies
    );
    assert_eq!(
        changes_for(&pool, guest_link, guest).await,
        changes_before + 1,
        "the guest's inbox is told its copy changed"
    );
    assert_eq!(stored_policy(&pool, other).await.0, GuestPolicy::default());
    assert_eq!(
        stored_policy(&pool, snapshot).await.0,
        GuestPolicy::default()
    );

    // Turning invites back on reaches the guests too, and their projections
    // drop the key again, as a fresh default one does.
    repo.upsert_event_fixture(copy_of(
        organizer_id,
        organizer_link,
        calendar(&repo, organizer_link, &organizer, "owner").await,
        &organizer,
        GuestPolicy::default(),
        2,
    ))
    .await
    .unwrap();
    assert_eq!(
        stored_policy(&pool, guest).await,
        (GuestPolicy::default(), vec![None])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_guest_copy_keeps_its_organizers_policy_over_a_stale_one(pool: PgPool) {
    let organizer_id = "macro|stale-organizer@example.com";
    let guest_id = "macro|stale-guest@example.com";
    let organizer_link = insert_link(&pool, organizer_id).await;
    let guest_link = insert_link(&pool, guest_id).await;
    let organizer = link_email(&pool, organizer_link).await;
    let repo = PgCalendarRepository::new(pool.clone());
    repo.upsert_event_fixture(copy_of(
        organizer_id,
        organizer_link,
        calendar(&repo, organizer_link, &organizer, "owner").await,
        &organizer,
        NO_INVITES,
        1,
    ))
    .await
    .unwrap();
    let guest_provider = provider_ids(&repo, guest_link).await;

    // Stored after its organizer's copy, a guest copy Google has not caught
    // up yet takes the organizer's policy.
    let outcome = repo
        .upsert_event(CalendarEventWrite::Fixture(copy_of(
            guest_id,
            guest_link,
            guest_provider,
            &organizer,
            GuestPolicy::default(),
            1,
        )))
        .await
        .unwrap();
    let guest = outcome.event_id;
    assert_eq!(stored_policy(&pool, guest).await.0, NO_INVITES);
    assert!(
        outcome.aligned_copies.is_empty(),
        "the write itself is not reported as another copy to refresh"
    );

    // A guest-side write echoes Google's stale policy; the copy keeps the
    // organizer's.
    repo.upsert_event_fixture(copy_of(
        guest_id,
        guest_link,
        guest_provider,
        &organizer,
        GuestPolicy::default(),
        2,
    ))
    .await
    .unwrap();
    assert_eq!(stored_policy(&pool, guest).await.0, NO_INVITES);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_secondary_calendars_copy_decides_the_policy_of_its_meeting(pool: PgPool) {
    let organizer_id = "macro|secondary-organizer@example.com";
    let guest_id = "macro|secondary-guest@example.com";
    let organizer_link = insert_link(&pool, organizer_id).await;
    let guest_link = insert_link(&pool, guest_id).await;
    let organizer_inbox = link_email(&pool, organizer_link).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary_id) = calendar(&repo, organizer_link, &organizer_inbox, "owner").await;
    let (_, secondary_id) = calendar(&repo, organizer_link, SECONDARY, "owner").await;
    let guest = repo
        .upsert_event_fixture(copy_of(
            guest_id,
            guest_link,
            provider_ids(&repo, guest_link).await,
            SECONDARY,
            GuestPolicy::default(),
            1,
        ))
        .await
        .unwrap();

    // The organizer's copy lives on the secondary calendar; Google also
    // invites their primary calendar, whose copy shares the entity and still
    // shows the old policy.
    let own = repo
        .upsert_event_fixture(copy_of(
            organizer_id,
            organizer_link,
            (account_id, secondary_id),
            SECONDARY,
            NO_INVITES,
            1,
        ))
        .await
        .unwrap();
    repo.upsert_event_fixture(copy_of(
        organizer_id,
        organizer_link,
        (account_id, primary_id),
        SECONDARY,
        GuestPolicy::default(),
        1,
    ))
    .await
    .unwrap();

    let (own_policy, own_projections) = stored_policy(&pool, own).await;
    assert_eq!(
        own_policy, NO_INVITES,
        "the organizer's own entity follows its copy"
    );
    assert!(
        own_projections
            .iter()
            .all(|projected| *projected == no_invites_projection()),
        "{own_projections:?}"
    );
    assert_eq!(stored_policy(&pool, guest).await.0, NO_INVITES);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_calendar_the_inbox_only_reads_decides_nothing(pool: PgPool) {
    let reader_id = "macro|policy-reader@example.com";
    let guest_id = "macro|policy-reader-guest@example.com";
    let reader_link = insert_link(&pool, reader_id).await;
    let guest_link = insert_link(&pool, guest_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let guest = repo
        .upsert_event_fixture(copy_of(
            guest_id,
            guest_link,
            provider_ids(&repo, guest_link).await,
            SECONDARY,
            GuestPolicy::default(),
            1,
        ))
        .await
        .unwrap();
    repo.upsert_event_fixture(copy_of(
        reader_id,
        reader_link,
        calendar(&repo, reader_link, SECONDARY, "reader").await,
        SECONDARY,
        NO_INVITES,
        1,
    ))
    .await
    .unwrap();
    assert_eq!(stored_policy(&pool, guest).await.0, GuestPolicy::default());
}
