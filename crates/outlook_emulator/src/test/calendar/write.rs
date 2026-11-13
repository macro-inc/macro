use calendar_events::domain::models::{
    CalendarAttendeeInput, CalendarEventPatch, ConferenceChange, ConferenceProvider, EventStart,
    EventTime,
};
use calendar_events::domain::ports::{
    CalendarMutationProvider, CalendarProviderErrorKind, ProviderInstanceUpdateOutcome,
    ProviderSeriesMutationOutcome,
};
use calendar_events::domain::replacement::CalendarReplacementProvider;
use serde_json::json;
use uuid::Uuid;

use super::super::{ADA, start};
use super::{SEED, access_token, at, draft, refreshed, retitle, stored, stored_id, target, timed};

fn guest(email: &str) -> CalendarAttendeeInput {
    CalendarAttendeeInput {
        email: email.into(),
        is_optional: false,
        response_status: None,
    }
}

#[tokio::test]
async fn an_event_created_from_macro_is_on_the_emulators_calendar() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let mut new = draft(
        "Planning",
        timed(
            "2026-11-19T18:00:00Z",
            "2026-11-19T19:00:00Z",
            "America/New_York",
        ),
    );
    new.description = Some("<p>Agenda to follow.</p>".into());
    new.location = Some("Room 2".into());
    new.attendees = vec![guest("grace@example.com")];
    new.idempotency_key = Some(Uuid::from_u128(7));

    let created = api.create_event(&token, &target, &new).await.unwrap();
    let again = api.create_event(&token, &target, &new).await.unwrap();

    let held = stored(&emulator, ADA, "default", "Planning");
    assert_eq!(
        held["start"],
        json!({"dateTime": "2026-11-19T18:00:00.0000000", "timeZone": "UTC"})
    );
    assert_eq!(held["originalStartTimeZone"], "America/New_York");
    assert_eq!(held["location"]["displayName"], "Room 2");
    assert_eq!(held["isOrganizer"], true);
    assert_eq!(
        held["attendees"][0]["emailAddress"]["address"],
        "grace@example.com"
    );
    assert_eq!(held["attendees"][0]["status"]["response"], "none");
    assert_eq!(created.event.title, "Planning");
    assert_eq!(created.event.location.as_deref(), Some("Room 2"));
    // The same idempotency key finds the event instead of making a second.
    assert_eq!(again.event.ical_uid, created.event.ical_uid);
    let planned = emulator.events(ADA, "default").unwrap();
    assert_eq!(
        planned
            .iter()
            .filter(|event| event["subject"] == "Planning")
            .count(),
        1
    );
}

#[tokio::test]
async fn changing_and_deleting_an_event_from_macro_reaches_the_emulator() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let review = stored_id(&emulator, ADA, "Design review");
    let patch = CalendarEventPatch {
        title: Some("Design review, round two".into()),
        time: Some(timed(
            "2026-11-12T19:00:00Z",
            "2026-11-12T20:30:00Z",
            "America/Los_Angeles",
        )),
        attendees: Some(vec![guest("grace@example.com")]),
        ..CalendarEventPatch::default()
    };

    let updated = api
        .update_event(&token, &target, &review, &patch)
        .await
        .unwrap();

    let updated = updated.unwrap();
    assert_eq!(updated.event.title, "Design review, round two");
    assert_eq!(updated.event.sequence, 1);
    let held = stored(&emulator, ADA, "default", "Design review, round two");
    assert_eq!(held["end"]["dateTime"], "2026-11-12T20:30:00.0000000");
    assert_eq!(held["attendees"].as_array().unwrap().len(), 1);
    // What the patch did not name is as it was.
    assert_eq!(held["location"]["displayName"], "Room 4");

    api.delete_event(&token, &target, &review).await.unwrap();

    let left = emulator.events(ADA, "default").unwrap();
    assert!(left.iter().all(|event| event["id"] != review.as_str()));
    assert_eq!(
        api.update_event(&token, &target, &review, &retitle("Late"))
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn one_occurrence_of_a_series_is_changed_deleted_and_the_series_cut_short() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let series = stored_id(&emulator, ADA, "Weekly sync");
    let key = |start: &str| EventStart::Timed(at(start)).occurrence_key();

    // The second Monday gets its own title.
    let outcome = api
        .update_event_instance(
            &token,
            &target,
            &series,
            &key("2026-11-09T17:00:00Z"),
            &retitle("Weekly sync: retro"),
        )
        .await
        .unwrap();
    let ProviderInstanceUpdateOutcome::Applied(echo) = outcome else {
        panic!("the occurrence exists");
    };
    assert_eq!(echo.overrides.len(), 2);
    let held = stored(&emulator, ADA, "default", "Weekly sync");
    let exceptions = held["exceptionOccurrences"].as_array().unwrap();
    let subjects: Vec<_> = exceptions
        .iter()
        .map(|exception| &exception["subject"])
        .collect();
    assert_eq!(subjects, vec!["Weekly sync: retro", "Weekly sync (moved)"]);

    // The moved occurrence is addressed by where the series put it.
    let outcome = api
        .delete_event_instance(&token, &target, &series, &key("2026-11-16T17:00:00Z"))
        .await
        .unwrap();
    let ProviderSeriesMutationOutcome::Applied(echo) = outcome else {
        panic!("the series survives");
    };
    assert_eq!(echo.occurrences.len(), 3);
    let held = stored(&emulator, ADA, "default", "Weekly sync");
    assert_eq!(
        held["cancelledOccurrences"],
        json!(["2026-11-16", "2026-11-23"])
    );

    // A deleted occurrence is not there to change.
    let gone = api
        .update_event_instance(
            &token,
            &target,
            &series,
            &key("2026-11-23T17:00:00Z"),
            &retitle("Ghost"),
        )
        .await
        .unwrap();
    assert!(matches!(
        gone,
        ProviderInstanceUpdateOutcome::OccurrenceGone(_)
    ));

    // Ending the series before its last Monday.
    let outcome = api
        .truncate_recurring_event(&token, &target, &series, &key("2026-11-30T17:00:00Z"))
        .await
        .unwrap();
    let ProviderSeriesMutationOutcome::Applied(echo) = outcome else {
        panic!("the series survives");
    };
    assert_eq!(echo.occurrences.len(), 2);
    let held = stored(&emulator, ADA, "default", "Weekly sync");
    assert_eq!(held["recurrence"]["range"]["type"], "endDate");
    assert_eq!(held["recurrence"]["range"]["endDate"], "2026-11-29");
    // The range changed, not the pattern: what was changed on single
    // occurrences is kept.
    assert_eq!(held["exceptionOccurrences"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_new_series_from_macro_expands_in_its_own_zone() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    // 09:00 in Paris, across the end of summer time on 25 October.
    let mut new = draft(
        "Standup",
        timed(
            "2026-10-22T07:00:00Z",
            "2026-10-22T07:15:00Z",
            "Europe/Paris",
        ),
    );
    new.recurrence_lines = vec!["RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3".into()];

    let created = api.create_event(&token, &target, &new).await.unwrap();

    let starts: Vec<_> = created
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
            "2026-10-22T07:00:00+00:00",
            "2026-10-29T08:00:00+00:00",
            "2026-11-05T08:00:00+00:00",
        ]
    );
    let held = stored(&emulator, ADA, "default", "Standup");
    assert_eq!(held["type"], "seriesMaster");
    assert_eq!(
        held["recurrence"]["range"]["recurrenceTimeZone"],
        "Europe/Paris"
    );
}

#[tokio::test]
async fn a_teams_meeting_gets_a_join_link_only_where_the_calendar_allows_teams() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let mut new = draft(
        "Kickoff",
        timed("2026-11-24T16:00:00Z", "2026-11-24T17:00:00Z", "UTC"),
    );
    new.description = Some("<p>Slides attached.</p>".into());
    new.conference = Some(ConferenceChange::MicrosoftTeams);

    let created = api.create_event(&token, &target, &new).await.unwrap();

    assert_eq!(
        created.event.conference_provider,
        Some(ConferenceProvider::MicrosoftTeams)
    );
    let join = created.event.conference_url.clone().unwrap();
    assert!(join.starts_with("https://teams.microsoft.com/l/meetup-join/"));
    // Editing the description keeps the block Teams wrote into the body.
    let kickoff = stored_id(&emulator, ADA, "Kickoff");
    let patch = CalendarEventPatch {
        description: Some("<p>Slides to follow.</p>".into()),
        ..CalendarEventPatch::default()
    };
    let updated = api
        .update_event(&token, &target, &kickoff, &patch)
        .await
        .unwrap()
        .unwrap();
    let description = updated.event.description.unwrap();
    assert!(description.contains("Slides to follow.") && description.contains(&join));

    // Ada may not write the birthday calendar, and it has no Teams.
    let birthdays = super::target(&emulator, ADA, "Birthdays");
    let refused = api
        .create_event(&token, &birthdays, &new)
        .await
        .unwrap_err();
    assert_eq!(refused.kind(), CalendarProviderErrorKind::Permanent);
    assert_eq!(emulator.events(ADA, "Birthdays").unwrap().len(), 1);
}

#[tokio::test]
async fn a_series_is_inspected_for_replacement_with_its_changed_and_deleted_occurrences() {
    let (emulator, api) = start(SEED).await;
    let token = access_token(&emulator);
    let target = target(&emulator, ADA, "Calendar");
    let series = stored_id(&emulator, ADA, "Weekly sync");

    let snapshot = api
        .inspect_replacement(&token, &target, &series, None, false)
        .await
        .unwrap();

    assert!(snapshot.is_series && snapshot.is_organizer);
    assert_eq!(snapshot.title, "Weekly sync");
    let occurrences: Vec<_> = snapshot
        .occurrences
        .iter()
        .map(|occurrence| {
            (
                occurrence["date"].as_str().unwrap(),
                occurrence["cancelled"] == true,
            )
        })
        .collect();
    assert_eq!(
        occurrences,
        vec![("2026-11-16", false), ("2026-11-23", true)]
    );
    assert_eq!(
        snapshot.occurrences[0]["body"]["subject"],
        "Weekly sync (moved)"
    );
    let moved = refreshed(&api, &token, &target, &series).await;
    assert_eq!(moved.overrides.len(), 1);
}
