//! The labels a search row carries, read from stored rows: a search hit has
//! no event loaded, so these reach the rule through `event_copies`.
use super::meeting_copies::link_email;
use super::*;
use crate::domain::labels::{EventLabels, EventRole};
use crate::domain::service::CalendarService;

const OWNER: &str = "macro|event-labels-owner@example.com";
const COLLEAGUE: &str = "colleague@example.com";

fn calendar(provider_calendar_id: &str, name: &str, access_role: &str) -> ProviderCalendar {
    ProviderCalendar {
        provider_calendar_id: provider_calendar_id.to_string(),
        name: name.to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some(access_role.to_string()),
        is_primary: false,
        is_selected: true,
        default_reminders: Vec::new(),
    }
}

fn own_row(email: &str, is_organizer: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_string(),
        display_name: None,
        response_status: AttendeeResponseStatus::Accepted,
        is_organizer,
        is_optional: false,
        is_self: false,
        comment: None,
    }
}

fn copy(
    link_id: Uuid,
    provider: (Uuid, Uuid),
    title: &str,
    organizer: &str,
    attendees: Vec<CalendarAttendee>,
    is_read_only: bool,
) -> CalendarEventUpsert {
    let mut upsert = timed_upsert(
        OWNER,
        link_id,
        provider,
        &format!("{title}@example.com"),
        title,
        1,
    );
    upsert.event.organizer_email = Some(organizer.to_string());
    upsert.event.attendees = attendees;
    upsert.event.is_read_only = is_read_only;
    upsert
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn labels_say_whose_calendar_each_stored_event_is_on(pool: PgPool) {
    let link_id = insert_link(&pool, OWNER).await;
    let inbox = link_email(&pool, link_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary) = provider_ids(&repo, link_id).await;
    let colleagues = repo
        .upsert_calendar_fixture(account_id, calendar(COLLEAGUE, COLLEAGUE, "owner"))
        .await
        .unwrap();
    let holidays = repo
        .upsert_calendar_fixture(
            account_id,
            calendar("holidays@example.com", "United States holidays", "reader"),
        )
        .await
        .unwrap();

    let dentist = copy(
        link_id,
        (account_id, colleagues),
        "Dentist",
        COLLEAGUE,
        Vec::new(),
        false,
    );
    let holiday = copy(
        link_id,
        (account_id, holidays),
        "Thanksgiving Day",
        &inbox,
        vec![own_row(&inbox, true)],
        true,
    );
    let organized = copy(
        link_id,
        (account_id, primary),
        "Planning",
        &inbox,
        vec![own_row(&inbox, true), own_row(COLLEAGUE, false)],
        false,
    );
    let invited = copy(
        link_id,
        (account_id, primary),
        "Review",
        COLLEAGUE,
        vec![own_row(COLLEAGUE, true), own_row(&inbox, false)],
        false,
    );
    let ids = [
        dentist.event.id,
        holiday.event.id,
        organized.event.id,
        invited.event.id,
    ];
    for upsert in [dentist, holiday, organized, invited] {
        repo.upsert_event_fixture(upsert).await.unwrap();
    }

    let labels = CalendarService::new(repo)
        .event_labels(OWNER, &ids)
        .await
        .unwrap();

    assert_eq!(
        labels[&ids[0]],
        EventLabels {
            calendar_name: Some(COLLEAGUE.to_string()),
            contributes_to_availability: Some(false),
            inbox: Some(inbox.clone()),
            role: None,
        },
        "a colleague's calendar held through the user's inbox with manage rights"
    );
    assert_eq!(
        labels[&ids[1]],
        EventLabels {
            calendar_name: Some("United States holidays".to_string()),
            contributes_to_availability: Some(false),
            inbox: Some(inbox.clone()),
            role: None,
        },
        "a read-only calendar naming the mailbox as organizer"
    );
    assert_eq!(
        labels[&ids[2]],
        EventLabels {
            calendar_name: Some("Primary".to_string()),
            contributes_to_availability: Some(true),
            inbox: Some(inbox.clone()),
            role: Some(EventRole::Organizer),
        }
    );
    assert_eq!(labels[&ids[3]].role, Some(EventRole::Guest));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_availability_setting_decides_the_schedule_label(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let link_id = insert_link(&pool, OWNER).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, _) = provider_ids(&repo, link_id).await;
    let team = repo
        .upsert_calendar_fixture(account_id, calendar("team@example.com", "Team", "owner"))
        .await
        .unwrap();
    let entry = copy(
        link_id,
        (account_id, team),
        "Offsite",
        "team@example.com",
        Vec::new(),
        false,
    );
    let id = entry.event.id;
    repo.upsert_event_fixture(entry).await.unwrap();
    let service = CalendarService::new(repo);

    let by_default = service.event_labels(OWNER, &[id]).await.unwrap();
    assert_eq!(by_default[&id].contributes_to_availability, Some(false));
    assert_eq!(by_default[&id].role, None);

    sqlx::query!(
        r#"
        INSERT INTO calendar_availability_preferences (user_id, calendar_id, contributes_to_availability)
        VALUES ($1, $2, true)
        "#,
        OWNER,
        team,
    )
    .execute(&pool)
    .await
    .unwrap();

    let on_schedule = service.event_labels(OWNER, &[id]).await.unwrap();
    assert_eq!(on_schedule[&id].contributes_to_availability, Some(true));
    assert_eq!(
        on_schedule[&id].role,
        Some(EventRole::Organizer),
        "a calendar of their own schedule that they can write, as the tools read it"
    );
}

/// A hit the requester reads through a channel is someone else's copy.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_users_copy_says_nothing_about_the_requester(pool: PgPool) {
    let sharer = "macro|event-labels-sharer@example.com";
    let sharer_link = insert_link(&pool, sharer).await;
    insert_link(&pool, OWNER).await;
    let inbox = link_email(&pool, sharer_link).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, sharer_link).await;
    let shared = copy(
        sharer_link,
        provider,
        "Shared",
        &inbox,
        vec![own_row(&inbox, true)],
        false,
    );
    let id = shared.event.id;
    repo.upsert_event_fixture(shared).await.unwrap();

    let labels = CalendarService::new(repo)
        .event_labels(OWNER, &[id, Uuid::now_v7()])
        .await
        .unwrap();

    assert_eq!(labels.len(), 1, "an id with no event is absent");
    assert_eq!(labels[&id], EventLabels::default());
}
