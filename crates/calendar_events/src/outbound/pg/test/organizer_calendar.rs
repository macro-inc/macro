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
    assert_eq!(preview.viewer_calendar_ids, [primary_id, secondary_id]);
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

/// An event made on the inbox's secondary calendar: the organizer's copy
/// there and the invitation Google sends the inbox's primary calendar, one
/// entity whose canonical copy is the invitation.
struct SecondaryMeeting {
    owner_id: &'static str,
    event_id: Uuid,
    link_id: Uuid,
    account_id: Uuid,
    primary_id: Uuid,
    secondary_id: Uuid,
    inbox_email: String,
}

impl SecondaryMeeting {
    async fn new(pool: &PgPool, repo: &PgCalendarRepository, owner_id: &'static str) -> Self {
        let link_id = insert_link(pool, owner_id).await;
        let inbox_email = link_email(pool, link_id).await;
        let (account_id, primary_id) = grant_and_provider_ids(repo, link_id).await;
        let secondary_id = repo
            .upsert_calendar_fixture(account_id, secondary_calendar(SECONDARY, "owner"))
            .await
            .unwrap();
        let meeting = Self {
            owner_id,
            event_id: Uuid::nil(),
            link_id,
            account_id,
            primary_id,
            secondary_id,
            inbox_email,
        };
        let event_id = repo
            .upsert_event(CalendarEventWrite::UserMutation(
                meeting.copy(meeting.secondary_id),
            ))
            .await
            .unwrap()
            .event_id;
        repo.upsert_event_fixture(meeting.copy(meeting.primary_id))
            .await
            .unwrap();
        Self {
            event_id,
            ..meeting
        }
    }

    /// The meeting as the copy on `calendar_id` holds it before any edit.
    fn copy(&self, calendar_id: Uuid) -> CalendarEventUpsert {
        copy_of(
            self.owner_id,
            self.link_id,
            (self.account_id, calendar_id),
            SECONDARY,
            &self.inbox_email,
        )
    }

    /// The copy on `calendar_id` after the organizer renamed the meeting,
    /// added a guest and wrote an agenda, as Google stamps it `minutes`
    /// after the meeting was made.
    fn edited(&self, calendar_id: Uuid, minutes: i64) -> CalendarEventUpsert {
        let mut copy = self.copy(calendar_id);
        copy.event.title = "Renamed".to_string();
        copy.event.description = Some("Agenda".to_string());
        copy.event.attendees.push(CalendarAttendee {
            email: "ada@example.com".to_string(),
            display_name: None,
            response_status: AttendeeResponseStatus::NeedsAction,
            is_organizer: false,
            is_optional: false,
            is_self: false,
            comment: None,
        });
        copy.event.updated_at = copy.event.created_at + Duration::minutes(minutes);
        copy
    }
}

struct MeetingContent {
    title: String,
    description: Option<String>,
    content_updated_at: Option<DateTime<Utc>>,
    guests: Vec<String>,
}

async fn meeting_content(pool: &PgPool, event_id: Uuid) -> MeetingContent {
    sqlx::query_as!(
        MeetingContent,
        r#"
        SELECT event.title, event.description, event.content_updated_at,
               ARRAY(
                   SELECT attendee.email FROM calendar_event_attendees attendee
                   WHERE attendee.event_id = event.id ORDER BY attendee.email
               ) AS "guests!"
        FROM calendar_events event WHERE event.id = $1
        "#,
        event_id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// The title each listed copy of the meeting shows, canonical copy first.
async fn copy_titles(repo: &PgCalendarRepository, meeting: &SecondaryMeeting) -> Vec<String> {
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let range = OccurrenceRange {
        starts_at: starts_at - Duration::hours(1),
        ends_at: starts_at + Duration::hours(2),
        start_date: starts_at.date_naive(),
        end_date: starts_at.date_naive(),
    };
    let rows = repo
        .list_occurrences(meeting.owner_id, range, None, 10)
        .await
        .unwrap();
    let (event, _) = rows
        .into_iter()
        .map(OccurrenceListing::into_occurrence_event)
        .find(|(event, _)| event.id == meeting.event_id)
        .expect("the meeting lists");
    event.sources.into_iter().map(|copy| copy.title).collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_edit_through_the_organizers_copy_shows_until_the_invitation_catches_up(pool: PgPool) {
    let repo = PgCalendarRepository::new(pool.clone());
    let meeting =
        SecondaryMeeting::new(&pool, &repo, "macro|organizer-calendar-edit@example.com").await;
    let edit_stamp = meeting.edited(meeting.secondary_id, 10).event.updated_at;

    repo.upsert_event(CalendarEventWrite::UserMutation(
        meeting.edited(meeting.secondary_id, 10),
    ))
    .await
    .unwrap();

    let content = meeting_content(&pool, meeting.event_id).await;
    assert_eq!(content.title, "Renamed");
    assert_eq!(content.description.as_deref(), Some("Agenda"));
    assert_eq!(content.content_updated_at, Some(edit_stamp));
    assert!(content.guests.contains(&"ada@example.com".to_string()));
    assert_eq!(
        copy_titles(&repo, &meeting).await,
        ["Renamed", "Renamed"],
        "the invitation Google has yet to update reads as the organizer's copy"
    );

    // Before Google carries the edit over, the invitation changes for another
    // reason, as when its reminders are saved, and still holds the old title
    // and guests, even with an advanced sequence.
    let mut stale = meeting.copy(meeting.primary_id);
    stale.event.sequence += 1;
    stale.event.reminders = EventReminders {
        use_default: false,
        overrides: Vec::new(),
    };
    stale.event.updated_at = stale.event.created_at + Duration::minutes(5);
    repo.upsert_event(CalendarEventWrite::UserMutation(stale))
        .await
        .unwrap();

    let content = meeting_content(&pool, meeting.event_id).await;
    assert_eq!(
        content.title, "Renamed",
        "an older invitation cannot take the title back"
    );
    assert!(content.guests.contains(&"ada@example.com".to_string()));
    let reminders_use_default = sqlx::query_scalar!(
        "SELECT reminders_use_default FROM calendar_events WHERE id = $1",
        meeting.event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !reminders_use_default,
        "the invitation's own reminders still reach the entity"
    );

    // Google carries the edit to the invitation.
    let mut caught_up = meeting.edited(meeting.primary_id, 12);
    caught_up.event.sequence += 1;
    repo.upsert_event_fixture(caught_up).await.unwrap();

    let content = meeting_content(&pool, meeting.event_id).await;
    assert_eq!(content.title, "Renamed");
    assert_eq!(
        content.content_updated_at, None,
        "the invitation holds the content again"
    );
    assert_eq!(copy_titles(&repo, &meeting).await, ["Renamed", "Renamed"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_invitation_retakes_content_a_later_change_reached_first(pool: PgPool) {
    let repo = PgCalendarRepository::new(pool.clone());
    let meeting =
        SecondaryMeeting::new(&pool, &repo, "macro|organizer-calendar-later@example.com").await;
    repo.upsert_event(CalendarEventWrite::UserMutation(
        meeting.edited(meeting.secondary_id, 10),
    ))
    .await
    .unwrap();

    // Someone else's later change reaches the invitation first.
    let mut later = meeting.edited(meeting.primary_id, 20);
    later.event.title = "Moved to Thursday".to_string();
    repo.upsert_event_fixture(later).await.unwrap();

    let content = meeting_content(&pool, meeting.event_id).await;
    assert_eq!(content.title, "Moved to Thursday");
    assert_eq!(content.content_updated_at, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sync_of_the_organizers_copy_leaves_content_to_the_invitation(pool: PgPool) {
    let repo = PgCalendarRepository::new(pool.clone());
    let meeting =
        SecondaryMeeting::new(&pool, &repo, "macro|organizer-calendar-sync@example.com").await;

    // A change made outside Macro reaches the organizer's copy by sync.
    repo.upsert_event_fixture(meeting.edited(meeting.secondary_id, 10))
        .await
        .unwrap();

    let content = meeting_content(&pool, meeting.event_id).await;
    assert_eq!(content.title, "Focus time");
    assert_eq!(content.content_updated_at, None);
    assert_eq!(
        copy_titles(&repo, &meeting).await,
        ["Focus time", "Renamed"]
    );
}

/// The migration that logs events organized by a calendar their inbox
/// writes, so caches holding their pre-October-2026 capabilities refetch them.
const LOG_ORGANIZED_EVENTS: &str = include_str!(
    "../../../../../macro_db_client/migrations/20261026184741_log_events_organized_by_a_writable_calendar.sql"
);

/// A copy of another meeting on `calendar_id`, organized by `organizer`.
fn other_meeting(
    owner_id: &str,
    link_id: Uuid,
    provider: (Uuid, Uuid),
    uid: &str,
    organizer: &str,
    inbox_email: &str,
) -> CalendarEventUpsert {
    let mut copy = copy_of(owner_id, link_id, provider, organizer, inbox_email);
    copy.event.ical_uid = uid.to_string();
    copy.source.details_mut().provider_event_id = format!("provider-{uid}");
    copy
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_capability_backfill_logs_only_events_a_writable_calendar_organizes(pool: PgPool) {
    let owner_id = "macro|organizer-calendar-backfill@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let inbox_email = link_email(&pool, link_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary_id) = grant_and_provider_ids(&repo, link_id).await;
    let secondary_id = repo
        .upsert_calendar_fixture(account_id, secondary_calendar(SECONDARY, "owner"))
        .await
        .unwrap();
    let shared = "c_shared@group.calendar.google.com";
    let shared_id = repo
        .upsert_calendar_fixture(account_id, secondary_calendar(shared, "reader"))
        .await
        .unwrap();
    let organized = repo
        .upsert_event_fixture(copy_of(
            owner_id,
            link_id,
            (account_id, secondary_id),
            SECONDARY,
            &inbox_email,
        ))
        .await
        .unwrap();
    repo.upsert_event_fixture(copy_of(
        owner_id,
        link_id,
        (account_id, primary_id),
        SECONDARY,
        &inbox_email,
    ))
    .await
    .unwrap();
    for (uid, calendar_id, organizer) in [
        ("own@example.com", primary_id, inbox_email.as_str()),
        ("read-only@example.com", shared_id, shared),
        (
            "someone-elses@example.com",
            primary_id,
            "organizer@example.com",
        ),
    ] {
        repo.upsert_event_fixture(other_meeting(
            owner_id,
            link_id,
            (account_id, calendar_id),
            uid,
            organizer,
            &inbox_email,
        ))
        .await
        .unwrap();
    }
    let before = sqlx::query_scalar!(
        "SELECT seq FROM calendar_change_counters WHERE link_id = $1",
        link_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::raw_sql(LOG_ORGANIZED_EVENTS)
        .execute(&pool)
        .await
        .unwrap();

    let logged = sqlx::query!(
        r#"
        SELECT seq, kind, event_id
        FROM calendar_change_log
        WHERE link_id = $1 AND seq > $2
        ORDER BY seq
        "#,
        link_id,
        before,
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.seq, row.kind, row.event_id))
    .collect::<Vec<_>>();
    assert_eq!(logged, [(before + 1, 1, Some(organized))]);
    let after = sqlx::query_scalar!(
        "SELECT seq FROM calendar_change_counters WHERE link_id = $1",
        link_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after, before + 1, "the counter covers the logged row");
}
