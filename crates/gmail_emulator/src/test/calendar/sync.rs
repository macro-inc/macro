use calendar_events::domain::models::{EventStart, EventTime};
use calendar_events::domain::ports::GoogleCalendarProvider;
use chrono::NaiveDate;
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::{AccessRole, RequestRecord, Route, SeedReminder};

/// A weekly series at 09:00 in New York from late October, whose second
/// November occurrence was moved and whose third was cancelled, beside a
/// one-off event and an all-day one.
fn seeded_events() -> Vec<NewEvent> {
    vec![
        event_on("design1", "Design review", 5, 15),
        NewEvent::from_json(json!({
            "id": "standup1",
            "summary": "Standup",
            "start": { "dateTime": "2026-10-26T09:00:00-04:00", "timeZone": NEW_YORK },
            "end": { "dateTime": "2026-10-26T09:15:00-04:00", "timeZone": NEW_YORK },
            "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        })),
        NewEvent::from_json(json!({
            "id": "offsite1",
            "summary": "Offsite",
            "start": { "date": "2026-11-18" },
            "end": { "date": "2026-11-20" },
        })),
    ]
}

async fn seeded() -> GmailEmulator {
    let emulator = emulator_with(vec![mailbox_with_events(ADA, seeded_events())]).await;
    emulator
        .change_event(
            ADA,
            "primary",
            "standup1_20261109T140000Z",
            NewEvent::from_json(json!({
                "summary": "Standup (moved)",
                "start": { "dateTime": "2026-11-09T11:00:00-05:00", "timeZone": NEW_YORK },
                "end": { "dateTime": "2026-11-09T11:15:00-05:00", "timeZone": NEW_YORK },
            })),
        )
        .unwrap();
    emulator
        .delete_event(ADA, "primary", "standup1_20261116T140000Z")
        .unwrap();
    emulator
}

#[tokio::test]
async fn the_calendar_list_names_each_calendar_with_its_role_and_zone() {
    let emulator = emulator_with(vec![SeedMailbox {
        calendars: vec![
            SeedCalendar {
                summary: Some("Ada Example".to_string()),
                time_zone: Some(NEW_YORK.parse().unwrap()),
                default_reminders: Some(vec![SeedReminder {
                    method: "popup".to_string(),
                    minutes: 10,
                }]),
                ..SeedCalendar::default()
            },
            SeedCalendar {
                id: Some("team@group.calendar.example.com".to_string()),
                summary: Some("Team".to_string()),
                background_color: Some("#7986cb".to_string()),
                ..SeedCalendar::default()
            },
            SeedCalendar {
                id: Some("holidays@group.calendar.example.com".to_string()),
                summary: Some("Holidays".to_string()),
                access_role: Some(AccessRole::Reader),
                selected: Some(false),
                ..SeedCalendar::default()
            },
            SeedCalendar {
                id: Some("busy@group.calendar.example.com".to_string()),
                access_role: Some(AccessRole::FreeBusyReader),
                ..SeedCalendar::default()
            },
        ],
        ..SeedMailbox::new(ADA)
    }])
    .await;
    let token = emulator.access_token(ADA).unwrap();

    let calendars = calendar_client(&emulator)
        .list_calendars(&token, Uuid::now_v7())
        .await
        .unwrap();

    // Our sync asks for calendars it can read; a free/busy one is left out.
    let listed: Vec<_> = calendars
        .iter()
        .map(|calendar| {
            (
                calendar.name.as_str(),
                calendar.access_role.as_deref(),
                calendar.is_primary,
                calendar.is_selected,
            )
        })
        .collect();
    assert_eq!(
        listed,
        vec![
            ("Ada Example", Some("owner"), true, true),
            ("Holidays", Some("reader"), false, false),
            ("Team", Some("owner"), false, true),
        ]
    );
    let primary = &calendars[0];
    assert_eq!(primary.provider_calendar_id, ADA);
    assert_eq!(primary.time_zone.as_deref(), Some(NEW_YORK));
    assert_eq!(primary.default_reminders[0].minutes, 10);
    assert_eq!(calendars[2].color.as_deref(), Some("#7986cb"));
}

#[tokio::test]
async fn a_first_sync_reads_events_series_and_their_exceptions() {
    let emulator = seeded().await;
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);

    let batch = calendar_client(&emulator)
        .sync_events(&token, first_sync(&target))
        .await
        .unwrap();

    assert_eq!(batch.upserts.len(), 3);
    let mut observed = batch.observed_provider_event_ids.clone().unwrap();
    observed.sort();
    assert_eq!(observed, vec!["design1", "offsite1", "standup1"]);
    assert_eq!(batch.materialized_range, Some(target.range.clone()));
    assert!(!batch.next_sync_token.is_empty());

    let review = upsert(&batch.upserts, "Design review");
    assert_eq!(occurrence_keys(review), vec!["2026-11-05T15:00:00+00:00"]);
    assert_eq!(review.event.organizer_email.as_deref(), Some(ADA));
    // Google mints the UID from the event id and its own domain.
    assert_eq!(review.event.ical_uid.split_once('@').unwrap().0, "design1");

    // 09:00 in New York is 14:00 UTC once daylight saving ends on November 1.
    // The occurrence of the 9th moved two hours and keeps its original key;
    // the cancelled one of the 16th is gone.
    let standup = upsert(&batch.upserts, "Standup");
    assert_eq!(
        standup.event.recurrence_lines,
        vec!["RRULE:FREQ=WEEKLY;BYDAY=MO"]
    );
    assert_eq!(
        occurrence_keys(standup),
        vec![
            "2026-11-02T14:00:00+00:00",
            "2026-11-09T14:00:00+00:00",
            "2026-11-23T14:00:00+00:00",
            "2026-11-30T14:00:00+00:00",
        ]
    );
    assert_eq!(
        standup.occurrences[1].time,
        EventTime::Timed {
            starts_at: instant("2026-11-09T16:00:00Z"),
            ends_at: instant("2026-11-09T16:15:00Z"),
            time_zone: Some(NEW_YORK.to_string()),
        }
    );
    assert_eq!(standup.overrides.len(), 1);
    assert_eq!(
        standup.overrides[0].title.as_deref(),
        Some("Standup (moved)")
    );
    assert_eq!(
        standup.overrides[0].original_time,
        EventStart::Timed(instant("2026-11-09T14:00:00Z"))
    );

    let offsite = upsert(&batch.upserts, "Offsite");
    assert_eq!(
        offsite.event.time,
        EventTime::AllDay {
            start_date: NaiveDate::from_ymd_opt(2026, 11, 18).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 11, 20).unwrap(),
        }
    );
}

#[tokio::test]
async fn a_later_sync_reports_only_what_was_added_changed_and_deleted() {
    let emulator = seeded().await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);
    let first = client
        .sync_events(&token, first_sync(&target))
        .await
        .unwrap();

    emulator
        .add_event(ADA, "primary", event_on("lunch1", "Lunch", 12, 12))
        .unwrap();
    emulator
        .change_event(
            ADA,
            "primary",
            "design1",
            NewEvent::from_json(
                json!({ "summary": "Design review, room 4", "location": "Room 4" }),
            ),
        )
        .unwrap();
    emulator.delete_event(ADA, "primary", "offsite1").unwrap();
    emulator
        .delete_event(ADA, "primary", "standup1_20261123T140000Z")
        .unwrap();

    let second = client
        .sync_events(&token, next_sync(&target, &first.next_sync_token))
        .await
        .unwrap();

    // A token-driven sync never sweeps: it names what changed.
    assert_eq!(second.observed_provider_event_ids, None);
    assert_eq!(second.cancelled_provider_event_ids, vec!["offsite1"]);
    let mut titles: Vec<&str> = second
        .upserts
        .iter()
        .map(|upsert| upsert.event.title.as_str())
        .collect();
    titles.sort();
    assert_eq!(titles, vec!["Design review, room 4", "Lunch", "Standup"]);
    assert_eq!(
        upsert(&second.upserts, "Design review, room 4")
            .event
            .location
            .as_deref(),
        Some("Room 4")
    );
    // The series was refreshed from the emulator: one more occurrence is gone.
    assert_eq!(
        occurrence_keys(upsert(&second.upserts, "Standup")),
        vec![
            "2026-11-02T14:00:00+00:00",
            "2026-11-09T14:00:00+00:00",
            "2026-11-30T14:00:00+00:00",
        ]
    );

    let third = client
        .sync_events(&token, next_sync(&target, &second.next_sync_token))
        .await
        .unwrap();
    assert!(third.upserts.is_empty());
    assert!(third.cancelled_provider_event_ids.is_empty());
    assert_ne!(third.next_sync_token, second.next_sync_token);
}

#[tokio::test]
async fn an_expired_sync_token_makes_the_adapter_list_everything_again() {
    let emulator = seeded().await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);
    let first = client
        .sync_events(&token, first_sync(&target))
        .await
        .unwrap();
    emulator
        .add_event(ADA, "primary", event_on("lunch1", "Lunch", 12, 12))
        .unwrap();

    emulator.expire_sync_tokens(ADA, "primary").unwrap();
    emulator.clear_requests();
    let resynced = client
        .sync_events(&token, next_sync(&target, &first.next_sync_token))
        .await
        .unwrap();

    // The emulator refused the token with 410, and the adapter rebuilt the
    // whole window and came away with a token that works.
    let statuses: Vec<u16> = emulator
        .requests()
        .iter()
        .filter(|request| request.route == Some(Route::EventsList))
        .map(|request: &RequestRecord| request.status)
        .collect();
    assert_eq!(statuses, vec![410, 200, 200, 200]);
    assert_eq!(resynced.upserts.len(), 4);
    assert_eq!(resynced.observed_provider_event_ids.unwrap().len(), 4);
    let after = client
        .sync_events(&token, next_sync(&target, &resynced.next_sync_token))
        .await
        .unwrap();
    assert!(after.upserts.is_empty());
}

#[tokio::test]
async fn a_listing_is_paged_and_only_its_last_page_carries_the_sync_token() {
    let events = (1..=5)
        .map(|day| event_on(&format!("event{day}"), &format!("Event {day}"), day, 10))
        .collect();
    let emulator = emulator_with(vec![mailbox_with_events(ADA, events)]).await;
    let page = |token: &str| format!("/calendars/primary/events?maxResults=2&pageToken={token}");

    let (_, first) = api(&emulator, ADA, reqwest::Method::GET, &page("0"), None).await;
    let (_, second) = api(
        &emulator,
        ADA,
        reqwest::Method::GET,
        &page(first["nextPageToken"].as_str().unwrap()),
        None,
    )
    .await;
    let (_, last) = api(
        &emulator,
        ADA,
        reqwest::Method::GET,
        &page(second["nextPageToken"].as_str().unwrap()),
        None,
    )
    .await;

    assert_eq!(first["items"].as_array().unwrap().len(), 2);
    assert!(first.get("nextSyncToken").is_none());
    assert_eq!(last["items"].as_array().unwrap().len(), 1);
    assert!(last.get("nextPageToken").is_none());

    // A sync token stands for the listing that earned it and takes no bounds.
    let token = last["nextSyncToken"].as_str().unwrap();
    let bounded =
        format!("/calendars/primary/events?syncToken={token}&timeMin=2026-11-01T00:00:00Z");
    let (status, _) = api(&emulator, ADA, reqwest::Method::GET, &bounded, None).await;
    assert_eq!(status, 400);
}
