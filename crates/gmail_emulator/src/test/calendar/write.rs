use calendar_events::domain::ics::EventSnapshot;
use calendar_events::domain::models::{
    CalendarAttendeeInput, CalendarEventPatch, ConferenceChange, ConferenceProvider,
    EventReminderOverride, EventReminders, GuestPolicy,
};
use calendar_events::domain::ports::{
    CalendarMutationProvider, CalendarProviderErrorKind, GoogleCalendarProvider,
    ProviderImportOutcome, ProviderInstanceUpdateOutcome, ProviderSeriesMutationOutcome,
};
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::AccessRole;

fn guest(email: &str) -> CalendarAttendeeInput {
    CalendarAttendeeInput {
        email: email.to_string(),
        is_optional: false,
        response_status: None,
    }
}

#[tokio::test]
async fn an_event_our_code_creates_is_in_the_emulator_and_is_created_once() {
    let emulator = emulator_with(vec![SeedMailbox::new(ADA), SeedMailbox::new(BOB)]).await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);
    let planning = CalendarEventDraft {
        idempotency_key: Some(Uuid::now_v7()),
        description: Some("Agenda to follow".to_string()),
        location: Some("Room 2".to_string()),
        attendees: vec![guest(BOB), guest(GRACE)],
        reminders: Some(EventReminders {
            use_default: false,
            overrides: vec![EventReminderOverride {
                method: "popup".to_string(),
                minutes: 5,
            }],
        }),
        conference: Some(ConferenceChange::GoogleMeet),
        guest_policy: Some(GuestPolicy {
            can_modify: false,
            can_invite_others: false,
            can_see_other_guests: true,
        }),
        ..draft(
            "Planning",
            timed("2026-11-10T16:00:00Z", "2026-11-10T17:00:00Z"),
        )
    };

    let created = client
        .create_event(&token, &target, &planning)
        .await
        .unwrap();
    let again = client
        .create_event(&token, &target, &planning)
        .await
        .unwrap();

    // What our code got back is what the emulator holds.
    assert_eq!(created.event.title, "Planning");
    assert_eq!(
        created.event.conference_provider,
        Some(ConferenceProvider::GoogleMeet)
    );
    assert!(created.event.conference_url.is_some());
    assert_eq!(created.event.guest_policy, planning.guest_policy.unwrap());
    assert_eq!(created.event.reminders, planning.reminders.clone().unwrap());
    assert_eq!(created.occurrences.len(), 1);
    let events = emulator.events(ADA, "primary").unwrap();
    assert_eq!(events.len(), 1, "a retried creation makes no second event");
    assert_eq!(again.event.ical_uid, created.event.ical_uid);
    let held = &events[0];
    assert_eq!(held["summary"], "Planning");
    assert_eq!(held["location"], "Room 2");
    assert_eq!(held["guestsCanInviteOthers"], false);
    assert_eq!(
        held["hangoutLink"].as_str(),
        created.event.conference_url.as_deref()
    );
    assert_eq!(
        held["attendees"],
        json!([
            { "email": BOB, "responseStatus": "needsAction" },
            { "email": GRACE, "responseStatus": "needsAction" },
        ])
    );

    // The guest who is a user here has the meeting on their own calendar.
    let invitation = stored(&emulator, BOB, held["id"].as_str().unwrap());
    assert_eq!(invitation["summary"], "Planning");
    assert_eq!(invitation["organizer"]["email"], ADA);
    assert_eq!(invitation["attendees"][0]["self"], true);
}

#[tokio::test]
async fn our_changes_and_deletions_reach_the_emulator() {
    let emulator = emulator_with(vec![mailbox_with_events(
        ADA,
        vec![event_on("design1", "Design review", 5, 15)],
    )])
    .await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);

    let updated = client
        .update_event(
            &token,
            &target,
            "design1",
            &CalendarEventPatch {
                title: Some("Design review v2".to_string()),
                location: Some("Room 4".to_string()),
                time: Some(timed("2026-11-06T15:00:00Z", "2026-11-06T16:30:00Z")),
                ..CalendarEventPatch::default()
            },
        )
        .await
        .unwrap()
        .unwrap();

    assert_eq!(updated.event.title, "Design review v2");
    assert_eq!(updated.event.sequence, 1, "a new time is a new sequence");
    let held = stored(&emulator, ADA, "design1");
    assert_eq!(held["summary"], "Design review v2");
    assert_eq!(held["location"], "Room 4");
    assert_eq!(held["start"]["dateTime"], "2026-11-06T15:00:00Z");
    assert_eq!(held["end"]["dateTime"], "2026-11-06T16:30:00Z");

    // An empty text clears the field, as our patch means it.
    client
        .update_event(
            &token,
            &target,
            "design1",
            &CalendarEventPatch {
                location: Some(String::new()),
                ..CalendarEventPatch::default()
            },
        )
        .await
        .unwrap();
    assert!(stored(&emulator, ADA, "design1").get("location").is_none());

    client
        .delete_event(&token, &target, "design1")
        .await
        .unwrap();
    assert_eq!(stored(&emulator, ADA, "design1")["status"], "cancelled");
    // Deleting what is already deleted answers 410, which our code accepts.
    client
        .delete_event(&token, &target, "design1")
        .await
        .unwrap();
    let missing = client
        .update_event(
            &token,
            &target,
            "nosuchevent",
            &CalendarEventPatch::default(),
        )
        .await
        .unwrap();
    assert!(missing.is_none());
}

#[tokio::test]
async fn one_occurrence_of_a_series_is_changed_deleted_and_the_series_cut_short() {
    let emulator = emulator_with(vec![SeedMailbox::new(ADA)]).await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);
    let series = client
        .create_event(
            &token,
            &target,
            &CalendarEventDraft {
                recurrence_lines: vec!["RRULE:FREQ=DAILY;COUNT=10".to_string()],
                ..draft(
                    "Daily sync",
                    timed("2026-11-02T10:00:00Z", "2026-11-02T10:30:00Z"),
                )
            },
        )
        .await
        .unwrap();
    assert_eq!(series.occurrences.len(), 10);
    let series_id = emulator.events(ADA, "primary").unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let changed = client
        .update_event_instance(
            &token,
            &target,
            &series_id,
            "2026-11-04T10:00:00+00:00",
            &CalendarEventPatch {
                title: Some("Daily sync (retro)".to_string()),
                ..CalendarEventPatch::default()
            },
        )
        .await
        .unwrap();
    let ProviderInstanceUpdateOutcome::Applied(changed) = changed else {
        panic!("the occurrence was not changed");
    };
    assert_eq!(changed.overrides.len(), 1);
    assert_eq!(
        changed.overrides[0].title.as_deref(),
        Some("Daily sync (retro)")
    );
    let exception = stored(&emulator, ADA, &format!("{series_id}_20261104T100000Z"));
    assert_eq!(exception["recurringEventId"], series_id.as_str());
    assert_eq!(
        exception["originalStartTime"]["dateTime"],
        "2026-11-04T10:00:00Z"
    );

    let deleted = client
        .delete_event_instance(&token, &target, &series_id, "2026-11-05T10:00:00+00:00")
        .await
        .unwrap();
    let ProviderSeriesMutationOutcome::Applied(deleted) = deleted else {
        panic!("the series did not survive losing an occurrence");
    };
    assert_eq!(deleted.occurrences.len(), 9);

    // An occurrence the series does not have is reported, not invented.
    let absent = client
        .update_event_instance(
            &token,
            &target,
            &series_id,
            "2026-11-05T10:00:00+00:00",
            &CalendarEventPatch::default(),
        )
        .await
        .unwrap();
    assert!(matches!(
        absent,
        ProviderInstanceUpdateOutcome::OccurrenceGone(_)
    ));

    let cut = client
        .truncate_recurring_event(&token, &target, &series_id, "2026-11-07T10:00:00+00:00")
        .await
        .unwrap();
    let ProviderSeriesMutationOutcome::Applied(cut) = cut else {
        panic!("the series was not cut short");
    };
    assert_eq!(
        occurrence_keys(&cut),
        vec![
            "2026-11-02T10:00:00+00:00",
            "2026-11-03T10:00:00+00:00",
            "2026-11-04T10:00:00+00:00",
            "2026-11-06T10:00:00+00:00",
        ]
    );
    assert_eq!(
        stored(&emulator, ADA, &series_id)["recurrence"],
        json!(["RRULE:FREQ=DAILY;UNTIL=20261107T095959Z"])
    );

    // Cutting it at its first occurrence deletes the series.
    let gone = client
        .truncate_recurring_event(&token, &target, &series_id, "2026-11-02T10:00:00+00:00")
        .await
        .unwrap();
    assert!(matches!(gone, ProviderSeriesMutationOutcome::SeriesDeleted));
    assert_eq!(stored(&emulator, ADA, &series_id)["status"], "cancelled");
    assert_eq!(emulator.events(ADA, "primary").unwrap().len(), 1);
}

#[tokio::test]
async fn a_snapshot_is_imported_once_under_the_meeting_uid() {
    let emulator = emulator_with(vec![SeedMailbox::new(ADA)]).await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let target = target(ADA);
    let snapshot = EventSnapshot {
        ical_uid: "launch-2026@example.com".to_string(),
        sequence: 2,
        title: "Launch".to_string(),
        description: Some("Shared from a channel".to_string()),
        location: None,
        time: timed("2026-11-20T18:00:00Z", "2026-11-20T19:00:00Z"),
        recurrence_lines: Vec::new(),
        organizer_email: Some(GRACE.to_string()),
        organizer_name: Some("Grace Hopper".to_string()),
    };

    let imported = client
        .import_event(&token, &target, &snapshot)
        .await
        .unwrap();
    let ProviderImportOutcome::Imported(imported) = imported else {
        panic!("the snapshot was not imported");
    };
    assert!(imported.event.is_snapshot);
    assert_eq!(imported.event.ical_uid, "launch-2026@example.com");
    assert_eq!(imported.event.organizer_email.as_deref(), Some(GRACE));
    assert_eq!(imported.event.sequence, 2);

    let again = client
        .import_event(&token, &target, &snapshot)
        .await
        .unwrap();
    assert!(matches!(again, ProviderImportOutcome::AlreadyHeld));
    assert_eq!(emulator.events(ADA, "primary").unwrap().len(), 1);

    // Google imports only for the organizer or a guest.
    let stranger = json!({
        "iCalUID": "other-2026@example.com",
        "summary": "Not mine",
        "start": { "dateTime": "2026-11-21T18:00:00Z" },
        "end": { "dateTime": "2026-11-21T19:00:00Z" },
        "organizer": { "email": GRACE },
    });
    let (status, refusal) = api(
        &emulator,
        ADA,
        reqwest::Method::POST,
        "/calendars/primary/events/import",
        Some(stranger),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(
        refusal["error"]["errors"][0]["reason"],
        "participantIsNeitherOrganizerNorAttendee"
    );
}

#[tokio::test]
async fn a_calendar_the_user_can_only_read_refuses_writes() {
    let emulator = emulator_with(vec![SeedMailbox {
        calendars: vec![SeedCalendar {
            id: Some("holidays@group.calendar.example.com".to_string()),
            access_role: Some(AccessRole::Reader),
            events: vec![event_on("founders1", "Founders' day", 11, 0)],
            ..SeedCalendar::default()
        }],
        ..SeedMailbox::new(ADA)
    }])
    .await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let holidays = target("holidays@group.calendar.example.com");

    let read = client
        .sync_events(&token, first_sync(&holidays))
        .await
        .unwrap();
    assert_eq!(read.upserts.len(), 1);
    let refused = client
        .create_event(
            &token,
            &holidays,
            &draft(
                "Mine",
                timed("2026-11-12T10:00:00Z", "2026-11-12T11:00:00Z"),
            ),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.kind(), CalendarProviderErrorKind::Permanent);
    assert!(refused.message().contains("requiredAccessLevel"));

    // Whoever publishes the calendar still changes it.
    emulator
        .change_event(
            ADA,
            "holidays@group.calendar.example.com",
            "founders1",
            NewEvent::from_json(json!({ "summary": "Founders' day (observed)" })),
        )
        .unwrap();
}
