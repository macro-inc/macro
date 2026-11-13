use calendar_events::domain::models::{AttendeeResponseStatus, EventStart, EventTime};
use calendar_events::domain::outlook::{OutlookCalendarReader, OutlookEventRefresh};
use calendar_events::domain::ports::CalendarProviderErrorKind;
use serde_json::json;

use super::super::{ADA, start};
use super::{
    SEED, access_token, at, binding, new_event, refreshed, round, stored_id, target, timed,
};

#[tokio::test]
async fn discovery_names_the_calendars_in_the_mailbox_time_zone() {
    let (emulator, api) = start(SEED).await;

    let discovery = api
        .calendars(&access_token(&emulator), binding())
        .await
        .unwrap();

    assert_eq!(discovery.unmapped_time_zone, None);
    let found: Vec<_> = discovery
        .calendars
        .iter()
        .map(|found| {
            let calendar = &found.calendar;
            (
                calendar.name.as_str(),
                calendar.is_primary,
                calendar.access_role.as_deref(),
                calendar.color.as_deref(),
                calendar.time_zone.as_deref(),
                found.online_meeting_providers.len(),
            )
        })
        .collect();
    assert_eq!(
        found,
        vec![
            (
                "Calendar",
                true,
                Some("writer"),
                None,
                Some("America/Los_Angeles"),
                1
            ),
            (
                "Birthdays",
                false,
                Some("reader"),
                Some("#e3008c"),
                Some("America/Los_Angeles"),
                0
            ),
        ]
    );
}

#[tokio::test]
async fn a_mailbox_time_zone_macro_cannot_map_does_not_fail_discovery() {
    let (emulator, api) = start(SEED).await;
    emulator.set_time_zone(ADA, "Customized Time Zone").unwrap();

    let discovery = api
        .calendars(&access_token(&emulator), binding())
        .await
        .unwrap();

    assert_eq!(
        discovery.unmapped_time_zone.as_deref(),
        Some("Customized Time Zone")
    );
    assert_eq!(discovery.calendars.len(), 2);
    assert!(
        discovery
            .calendars
            .iter()
            .all(|found| found.calendar.time_zone.is_none())
    );
}

#[tokio::test]
async fn the_first_round_lists_events_and_pairs_occurrences_with_their_series() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let review = stored_id(&emulator, ADA, "Design review");
    let series = stored_id(&emulator, ADA, "Weekly sync");
    let offsite = stored_id(&emulator, ADA, "Offsite");

    let (members, removed, _delta) = round(&api, &token, &target, None).await;

    assert_eq!(removed, Vec::<String>::new());
    let masters = |master: &str| members.iter().filter(|(_, of)| of == master).count();
    assert_eq!(masters(&review), 1);
    assert_eq!(masters(&offsite), 1);
    // The series itself and its four occurrences: five, less the deleted one.
    assert_eq!(masters(&series), 5);
    assert_eq!(members.len(), 7);
}

#[tokio::test]
async fn a_series_reads_back_with_its_moved_occurrence_and_without_the_deleted_one() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let series = stored_id(&emulator, ADA, "Weekly sync");

    let upsert = refreshed(&api, &token, &target, &series).await;

    assert_eq!(upsert.event.title, "Weekly sync");
    assert_eq!(
        upsert.event.recurrence_lines,
        vec!["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;WKST=SU;COUNT=5"]
    );
    assert_eq!(
        upsert.event.time,
        timed(
            "2026-11-02T17:00:00Z",
            "2026-11-02T17:30:00Z",
            "America/Los_Angeles"
        )
    );
    let starts: Vec<_> = upsert
        .occurrences
        .iter()
        .map(|occurrence| match &occurrence.time {
            EventTime::Timed { starts_at, .. } => starts_at.to_rfc3339(),
            EventTime::AllDay { start_date, .. } => start_date.to_string(),
        })
        .collect();
    assert_eq!(
        starts,
        vec![
            "2026-11-02T17:00:00+00:00",
            "2026-11-09T17:00:00+00:00",
            // The third Monday's meeting, moved to Tuesday afternoon.
            "2026-11-17T22:00:00+00:00",
            "2026-11-30T17:00:00+00:00",
        ]
    );
    assert_eq!(upsert.overrides.len(), 1);
    let moved = &upsert.overrides[0];
    assert_eq!(
        moved.original_time,
        EventStart::Timed(at("2026-11-16T17:00:00Z"))
    );
    assert_eq!(moved.title.as_deref(), Some("Weekly sync (moved)"));
    assert_eq!(
        moved.time,
        timed(
            "2026-11-17T22:00:00Z",
            "2026-11-17T22:30:00Z",
            "America/Los_Angeles"
        )
    );
}

#[tokio::test]
async fn a_later_round_reports_only_what_changed() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let review = stored_id(&emulator, ADA, "Design review");
    let series = stored_id(&emulator, ADA, "Weekly sync");
    let offsite = stored_id(&emulator, ADA, "Offsite");
    let (members, _, delta) = round(&api, &token, &target, None).await;

    let (members_idle, removed_idle, delta) = round(&api, &token, &target, Some(delta)).await;
    assert!(members_idle.is_empty() && removed_idle.is_empty());

    // In Outlook: a new event, a renamed one, a deleted one, and one
    // occurrence of the series deleted.
    let lunch = emulator
        .add_event(
            ADA,
            "default",
            &new_event(json!({
                "subject": "Lunch",
                "start": {"dateTime": "2026-11-13T12:00:00", "timeZone": "America/Los_Angeles"},
                "end": {"dateTime": "2026-11-13T13:00:00", "timeZone": "America/Los_Angeles"},
            })),
        )
        .unwrap();
    emulator
        .update_event(
            ADA,
            &review,
            &new_event(json!({"subject": "Design review v2"})),
        )
        .unwrap();
    emulator.delete_event(ADA, &offsite).unwrap();
    let second_monday = members
        .iter()
        .filter(|(id, of)| of == &series && id != &series)
        .map(|(id, _)| id.clone())
        .nth(1)
        .unwrap();
    emulator.delete_event(ADA, &second_monday).unwrap();

    let (members, removed, _) = round(&api, &token, &target, Some(delta)).await;

    let singles: Vec<_> = members.iter().filter(|(_, of)| of != &series).collect();
    assert_eq!(
        singles,
        vec![&(lunch.clone(), lunch), &(review.clone(), review.clone())]
    );
    // The series changed, so it is listed again with what is left of it.
    assert_eq!(members.iter().filter(|(_, of)| of == &series).count(), 4);
    assert_eq!(removed, vec![offsite, second_monday]);
    assert_eq!(
        refreshed(&api, &token, &target, &review).await.event.title,
        "Design review v2"
    );
}

#[tokio::test]
async fn an_expired_sync_state_asks_for_a_full_round() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let (members, _, delta) = round(&api, &token, &target, None).await;

    emulator.expire_delta_tokens(ADA).unwrap();
    let expired = api
        .calendar_page(&token, &target, true, Some(&delta))
        .await
        .err()
        .unwrap();

    assert_eq!(expired.kind(), CalendarProviderErrorKind::SyncTokenExpired);
    let (again, removed, _) = round(&api, &token, &target, None).await;
    assert_eq!(again, members);
    assert!(removed.is_empty());
}

#[tokio::test]
async fn a_secondary_calendar_is_read_as_a_view_of_its_occurrences() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Birthdays");

    let page = api
        .calendar_page(&token, &target, false, None)
        .await
        .unwrap();

    assert_eq!((page.next, page.delta), (None, None));
    assert_eq!(page.members.len(), 1);
    let (_, master) = &page.members[0];
    let upsert = refreshed(&api, &token, &target, master).await;
    assert_eq!(upsert.event.title, "Grace's birthday");
    assert!(upsert.event.is_read_only);
    assert_eq!(
        upsert.event.recurrence_lines,
        vec!["RRULE:FREQ=YEARLY;INTERVAL=1"]
    );
    assert_eq!(
        upsert.occurrences[0].time,
        EventTime::AllDay {
            start_date: "2026-12-09".parse().unwrap(),
            end_date: "2026-12-10".parse().unwrap(),
        }
    );
}

#[tokio::test]
async fn one_event_macro_cannot_read_is_named_and_the_rest_still_reads() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    // A series whose pattern Outlook's own clients can store and Graph
    // answers, but no write through Graph could make.
    let unreadable = emulator
        .add_event(
            ADA,
            "default",
            &new_event(json!({
                "subject": "Imported series",
                "start": {"dateTime": "2026-11-10T08:00:00", "timeZone": "UTC"},
                "end": {"dateTime": "2026-11-10T09:00:00", "timeZone": "UTC"},
                "raw": {"recurrence": {
                    "pattern": {"type": "daily", "interval": 0},
                    "range": {"type": "noEnd", "startDate": "2026-11-10"},
                }},
            })),
        )
        .unwrap();
    let review = stored_id(&emulator, ADA, "Design review");

    let (members, _, _) = round(&api, &token, &target, None).await;
    let refresh = api
        .refresh_calendar_event(&token, &target, &unreadable)
        .await
        .unwrap();

    assert!(members.contains(&(unreadable.clone(), unreadable)));
    assert!(matches!(
        refresh,
        OutlookEventRefresh::Unreadable { field } if field == "recurrence.pattern.interval"
    ));
    assert_eq!(
        refreshed(&api, &token, &target, &review).await.event.title,
        "Design review"
    );
}

#[tokio::test]
async fn an_imported_meeting_reads_in_graphs_own_utc_and_its_organizer_holds_it() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    // Exchange imported it from another system's invitation: Graph names
    // its zone its own way, and lists the organizer as an unanswered guest.
    let imported = emulator
        .add_event(
            ADA,
            "default",
            &new_event(json!({
                "subject": "Vendor call",
                "start": {"dateTime": "2026-11-18T15:00:00", "timeZone": "UTC"},
                "end": {"dateTime": "2026-11-18T16:00:00", "timeZone": "UTC"},
                "originalStartTimeZone": "tzone://Microsoft/Utc",
                "originalEndTimeZone": "tzone://Microsoft/Utc",
                "organizer": {"emailAddress": {"name": "Vera Vendor", "address": "vera@example.com"}},
                "responseStatus": {"response": "accepted", "time": "2026-11-01T09:00:00Z"},
                "attendees": [
                    {"emailAddress": {"address": "vera@example.com"}, "type": "required"},
                    {"emailAddress": {"address": "ada@example.com"}, "type": "optional",
                     "status": {"response": "accepted", "time": "2026-11-01T09:00:00Z"}},
                ],
            })),
        )
        .unwrap();

    let upsert = refreshed(&api, &token, &target, &imported).await;

    assert_eq!(
        upsert.event.time,
        timed("2026-11-18T15:00:00Z", "2026-11-18T16:00:00Z", "Etc/UTC")
    );
    assert_eq!(
        upsert.event.organizer_email.as_deref(),
        Some("vera@example.com")
    );
    let answers: Vec<_> = upsert
        .event
        .attendees
        .iter()
        .map(|attendee| {
            (
                attendee.email.as_str(),
                attendee.response_status,
                attendee.is_optional,
            )
        })
        .collect();
    assert_eq!(
        answers,
        vec![
            ("vera@example.com", AttendeeResponseStatus::Accepted, false),
            ("ada@example.com", AttendeeResponseStatus::Accepted, true),
        ]
    );
}
