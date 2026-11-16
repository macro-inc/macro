use calendar_events::domain::models::{AttendeeResponseStatus, CalendarEventPatch, GuestPolicy};
use calendar_events::domain::ports::{CalendarMutationProvider, GoogleCalendarProvider};
use reqwest::Method;
use serde_json::json;

use super::*;
use crate::AttendeeResponse;

/// Ada's meeting with Bob, who is a user here, and Grace, who is not.
async fn meeting() -> GmailEmulator {
    let planning = NewEvent::from_json(json!({
        "id": "planning1",
        "summary": "Planning",
        "start": { "dateTime": "2026-11-10T16:00:00Z" },
        "end": { "dateTime": "2026-11-10T17:00:00Z" },
        "attendees": [
            { "email": ADA, "responseStatus": "accepted" },
            { "email": BOB },
            { "email": GRACE },
        ],
    }));
    emulator_with(vec![
        mailbox_with_events(ADA, vec![planning]),
        SeedMailbox::new(BOB),
        SeedMailbox::new(CAROL),
    ])
    .await
}

fn response_of(upsert: &CalendarEventUpsert, email: &str) -> AttendeeResponseStatus {
    upsert
        .event
        .attendees
        .iter()
        .find(|attendee| attendee.email == email)
        .unwrap_or_else(|| panic!("{email} is not on the event"))
        .response_status
}

/// The patch `rsvp_event` sends: the answering guest's row alone.
fn answer(email: &str, response: &str) -> Value {
    json!({
        "attendeesOmitted": true,
        "attendees": [{ "email": email, "responseStatus": response, "self": true }],
    })
}

#[tokio::test]
async fn a_guest_holds_a_copy_and_answers_reach_the_organizer() {
    let emulator = meeting().await;
    let client = calendar_client(&emulator);
    let (ada, bob) = (
        emulator.access_token(ADA).unwrap(),
        emulator.access_token(BOB).unwrap(),
    );
    let (ada_calendar, bob_calendar) = (target(ADA), target(BOB));
    let first = client
        .sync_events(&ada, first_sync(&ada_calendar))
        .await
        .unwrap();

    // Bob's own sync finds the invitation, with Bob marked as himself.
    let invited = client
        .sync_events(&bob, first_sync(&bob_calendar))
        .await
        .unwrap();
    let invitation = upsert(&invited.upserts, "Planning");
    assert_eq!(invitation.event.organizer_email.as_deref(), Some(ADA));
    let me: Vec<&str> = invitation
        .event
        .attendees
        .iter()
        .filter(|attendee| attendee.is_self)
        .map(|attendee| attendee.email.as_str())
        .collect();
    assert_eq!(me, vec![BOB]);
    assert_eq!(
        response_of(invitation, BOB),
        AttendeeResponseStatus::NeedsAction
    );

    // Bob answers on his copy; Grace, who has no calendar here, by mail.
    let (status, _) = api(
        &emulator,
        BOB,
        Method::PATCH,
        "/calendars/primary/events/planning1?sendUpdates=all",
        Some(answer(BOB, "accepted")),
    )
    .await;
    assert_eq!(status, 200);
    emulator
        .respond_to_event(
            ADA,
            "primary",
            "planning1",
            GRACE,
            AttendeeResponse::Declined,
        )
        .unwrap();

    let second = client
        .sync_events(&ada, next_sync(&ada_calendar, &first.next_sync_token))
        .await
        .unwrap();
    let planning = upsert(&second.upserts, "Planning");
    assert_eq!(response_of(planning, BOB), AttendeeResponseStatus::Accepted);
    assert_eq!(
        response_of(planning, GRACE),
        AttendeeResponseStatus::Declined
    );
    assert_eq!(response_of(planning, ADA), AttendeeResponseStatus::Accepted);

    // In that mode Google refuses a row for someone not yet invited.
    let (status, refusal) = api(
        &emulator,
        BOB,
        Method::PATCH,
        "/calendars/primary/events/planning1",
        Some(answer(CAROL, "accepted")),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(
        refusal["error"]["errors"][0]["reason"],
        "omittedAttendeesSpecified"
    );
}

#[tokio::test]
async fn a_guest_changes_only_what_the_organizer_allows() {
    let emulator = meeting().await;
    let client = calendar_client(&emulator);
    let ada = emulator.access_token(ADA).unwrap();
    let event = "/calendars/primary/events/planning1";
    let with_carol = json!({
        "attendees": [
            { "email": ADA, "responseStatus": "accepted" },
            { "email": BOB },
            { "email": GRACE },
            { "email": CAROL },
        ],
    });

    // Details are the organizer's. Reminders are each guest's own.
    let retitle = json!({ "summary": "Bob's planning" });
    let (status, refusal) = api(&emulator, BOB, Method::PATCH, event, Some(retitle.clone())).await;
    assert_eq!(status, 403);
    assert_eq!(
        refusal["error"]["errors"][0]["reason"],
        "forbiddenForNonOrganizer"
    );
    let reminders = json!({ "reminders": { "useDefault": false, "overrides": [] } });
    let (status, _) = api(&emulator, BOB, Method::PATCH, event, Some(reminders)).await;
    assert_eq!(status, 200);
    assert_eq!(
        stored(&emulator, ADA, "planning1")["reminders"]["useDefault"],
        true
    );

    // Guests invite others by default, and the new guest gets a copy.
    let (status, _) = api(
        &emulator,
        BOB,
        Method::PATCH,
        event,
        Some(with_carol.clone()),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(stored(&emulator, CAROL, "planning1")["summary"], "Planning");
    assert_eq!(
        stored(&emulator, ADA, "planning1")["attendees"]
            .as_array()
            .unwrap()
            .len(),
        4
    );

    // The organizer turns inviting off and hides the guest list.
    emulator
        .change_event(ADA, "primary", "planning1", NewEvent::from_json(json!({
            "attendees": [{ "email": ADA, "responseStatus": "accepted" }, { "email": BOB }, { "email": GRACE }],
        })))
        .unwrap();
    assert_eq!(stored(&emulator, CAROL, "planning1")["status"], "cancelled");
    client
        .update_event(
            &ada,
            &target(ADA),
            "planning1",
            &CalendarEventPatch {
                guest_policy: Some(GuestPolicy {
                    can_modify: false,
                    can_invite_others: false,
                    can_see_other_guests: false,
                }),
                ..CalendarEventPatch::default()
            },
        )
        .await
        .unwrap();
    let (status, _) = api(&emulator, BOB, Method::PATCH, event, Some(with_carol)).await;
    assert_eq!(status, 403);
    let (_, hidden) = api(&emulator, BOB, Method::GET, event, None).await;
    assert_eq!(hidden["attendeesOmitted"], true);
    assert_eq!(hidden["attendees"].as_array().unwrap().len(), 2);
    assert_eq!(hidden["attendees"][1]["email"], BOB);

    // With modify rights a guest's change is the meeting's.
    emulator
        .change_event(
            ADA,
            "primary",
            "planning1",
            NewEvent::from_json(json!({ "guestsCanModify": true })),
        )
        .unwrap();
    let (status, _) = api(&emulator, BOB, Method::PATCH, event, Some(retitle)).await;
    assert_eq!(status, 200);
    assert_eq!(
        stored(&emulator, ADA, "planning1")["summary"],
        "Bob's planning"
    );
}

#[tokio::test]
async fn an_uninvited_guest_and_a_cancelled_meeting_leave_the_guests_calendar() {
    let emulator = meeting().await;
    let client = calendar_client(&emulator);
    let (ada, bob) = (
        emulator.access_token(ADA).unwrap(),
        emulator.access_token(BOB).unwrap(),
    );
    let bob_calendar = target(BOB);
    let first = client
        .sync_events(&bob, first_sync(&bob_calendar))
        .await
        .unwrap();
    assert_eq!(first.upserts.len(), 1);

    // A guest who deletes their copy declines; the meeting goes on.
    client
        .delete_event(&bob, &bob_calendar, "planning1")
        .await
        .unwrap();
    let planning = stored(&emulator, ADA, "planning1");
    assert_eq!(planning["status"], "confirmed");
    assert_eq!(planning["attendees"][1]["responseStatus"], "declined");
    let second = client
        .sync_events(&bob, next_sync(&bob_calendar, &first.next_sync_token))
        .await
        .unwrap();
    assert_eq!(second.cancelled_provider_event_ids, vec!["planning1"]);

    // When the organizer deletes it, every other guest's copy goes too.
    emulator
        .change_event(
            ADA,
            "primary",
            "planning1",
            NewEvent::from_json(json!({
                "attendees": [{ "email": ADA }, { "email": CAROL }],
            })),
        )
        .unwrap();
    assert_eq!(stored(&emulator, CAROL, "planning1")["status"], "confirmed");
    client
        .delete_event(&ada, &target(ADA), "planning1")
        .await
        .unwrap();
    assert_eq!(stored(&emulator, CAROL, "planning1")["status"], "cancelled");
}
