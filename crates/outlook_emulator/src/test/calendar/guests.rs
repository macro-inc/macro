use calendar_events::domain::models::{AttendeeResponseStatus, CalendarAttendeeInput};
use calendar_events::domain::outlook::automatic_decline::{
    AutomaticDeclineProvider, AwaySubmissionOutcome,
};
use calendar_events::domain::ports::CalendarMutationProvider;
use serde_json::json;

use super::super::{ADA, BOB, start};
use super::{draft, refreshed, stored, stored_id, target, timed};

const SEED: &str = "mailboxes:\n  - email: ada@example.com\n    name: Ada Example\n  - email: bob@example.com\n    name: Bob Example\n";

fn response_of(
    attendees: &[calendar_events::domain::models::CalendarAttendee],
    email: &str,
) -> AttendeeResponseStatus {
    attendees
        .iter()
        .find(|attendee| attendee.email == email)
        .unwrap()
        .response_status
}

#[tokio::test]
async fn a_guest_holds_a_copy_and_their_answer_reaches_the_organizer() {
    let (emulator, api) = start(SEED).await;
    let ada = emulator.access_token(ADA).unwrap();
    let bob = emulator.access_token(BOB).unwrap();
    let adas = target(&emulator, ADA, "Calendar");
    let bobs = target(&emulator, BOB, "Calendar");
    let mut new = draft(
        "Roadmap",
        timed("2026-11-19T18:00:00Z", "2026-11-19T19:00:00Z", "UTC"),
    );
    new.attendees = vec![CalendarAttendeeInput {
        email: BOB.into(),
        is_optional: false,
        response_status: None,
    }];

    let created = api.create_event(&ada, &adas, &new).await.unwrap();

    // Bob's calendar holds his own copy of Ada's meeting.
    let copy = stored(&emulator, BOB, "default", "Roadmap");
    assert_eq!(copy["isOrganizer"], false);
    assert_eq!(copy["organizer"]["emailAddress"]["address"], ADA);
    assert_eq!(copy["responseStatus"]["response"], "none");
    assert_eq!(
        copy["iCalUId"].as_str(),
        Some(created.event.ical_uid.as_str())
    );
    let copy_id = copy["id"].as_str().unwrap().to_string();

    // Bob accepts in Outlook.
    let accepted = reqwest::Client::new()
        .post(format!(
            "{}/me/events/{copy_id}/accept",
            emulator.graph_url()
        ))
        .bearer_auth(&bob)
        .json(&json!({"sendResponse": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(accepted.status(), 202);

    let master = stored_id(&emulator, ADA, "Roadmap");
    let organizers = refreshed(&api, &ada, &adas, &master).await;
    assert_eq!(
        response_of(&organizers.event.attendees, BOB),
        AttendeeResponseStatus::Accepted
    );
    let guests = refreshed(&api, &bob, &bobs, &copy_id).await;
    assert_eq!(
        response_of(&guests.event.attendees, BOB),
        AttendeeResponseStatus::Accepted
    );
    assert_eq!(
        response_of(&guests.event.attendees, ADA),
        AttendeeResponseStatus::Accepted
    );

    // The organizer's change reaches the copy, which keeps Bob's answer.
    api.update_event(&ada, &adas, &master, &super::retitle("Roadmap 2027"))
        .await
        .unwrap();
    let copy = stored(&emulator, BOB, "default", "Roadmap 2027");
    assert_eq!(copy["responseStatus"]["response"], "accepted");

    // An organizer cannot answer their own meeting.
    let organizer = reqwest::Client::new()
        .post(format!(
            "{}/me/events/{master}/accept",
            emulator.graph_url()
        ))
        .bearer_auth(&ada)
        .json(&json!({"sendResponse": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(organizer.status(), 400);
}

#[tokio::test]
async fn declining_removes_the_guests_copy_and_cancelling_marks_it() {
    let (emulator, api) = start(SEED).await;
    let ada = emulator.access_token(ADA).unwrap();
    let bob = emulator.access_token(BOB).unwrap();
    let adas = target(&emulator, ADA, "Calendar");
    let bobs = target(&emulator, BOB, "Calendar");
    let invite = |title: &str| {
        let mut new = draft(
            title,
            timed("2026-11-19T18:00:00Z", "2026-11-19T19:00:00Z", "UTC"),
        );
        new.attendees = vec![CalendarAttendeeInput {
            email: BOB.into(),
            is_optional: false,
            response_status: None,
        }];
        new
    };
    api.create_event(&ada, &adas, &invite("Budget"))
        .await
        .unwrap();
    api.create_event(&ada, &adas, &invite("Hiring"))
        .await
        .unwrap();

    // Macro declines for Bob while he is away.
    let budget = stored_id(&emulator, BOB, "Budget");
    let declined = api
        .decline_away_invitation(&bob, &bobs, &budget, Some("Out of office"))
        .await
        .unwrap();

    assert!(matches!(declined, AwaySubmissionOutcome::Submitted));
    let left = emulator.events(BOB, "default").unwrap();
    assert!(left.iter().all(|event| event["subject"] != "Budget"));
    let master = stored_id(&emulator, ADA, "Budget");
    let organizers = refreshed(&api, &ada, &adas, &master).await;
    assert_eq!(
        response_of(&organizers.event.attendees, BOB),
        AttendeeResponseStatus::Declined
    );

    // Ada cancels the other meeting: Bob's copy stays, marked cancelled.
    let hiring = stored_id(&emulator, ADA, "Hiring");
    api.delete_event(&ada, &adas, &hiring).await.unwrap();

    let copy = stored(&emulator, BOB, "default", "Canceled: Hiring");
    assert_eq!(copy["isCancelled"], true);
}
