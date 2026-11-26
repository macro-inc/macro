//! What a guest may do to a meeting someone else organizes.

use email_e2e::gmail_emulator::{Fault, FaultError, RequestRecord, Route, SeedMailbox};
use email_e2e::{Calendar, DEFAULT_TIMEOUT, Report, Stack, StackOptions, User, events, eventually};
use serde_json::json;

/// Google's id for a user's own calendar.
const PRIMARY: &str = "primary";

async fn calendar_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await
}

/// A Google meeting `organizer` holds with `guest` invited, who may invite
/// others but not change it. Returns the organizer's calendar and event id,
/// the guest's calendar and event id, and the event's id at Google.
async fn review(
    stack: &Stack,
    organizer: &User,
    guest: &User,
) -> Result<((Calendar, String), (Calendar, String), String), Report> {
    for user in [organizer, guest] {
        stack.gmail().add_mailbox(&SeedMailbox {
            email: user.email().to_owned(),
            ..Default::default()
        })?;
    }
    let meeting = events::google_with(
        "Review",
        events::hour_in_days(2),
        json!({
            "guestsCanModify": false,
            "guestsCanInviteOthers": true,
            "guestsCanSeeOtherGuests": true,
            "attendees": [
                { "email": organizer.email(), "responseStatus": "accepted" },
                { "email": guest.email() },
            ],
        }),
    );
    let seeded = stack
        .gmail()
        .add_event(organizer.email(), PRIMARY, meeting)?;
    let provider_id = seeded["id"].as_str().unwrap_or_default().to_owned();
    organizer.link_gmail_with_calendar().await?;
    guest.link_gmail_with_calendar().await?;
    let mut held = Vec::new();
    for user in [organizer, guest] {
        let calendar = user.calendar()?;
        let item = calendar.wait_for_event("Review").await?;
        let id = item["event"]["id"].as_str().unwrap_or_default().to_owned();
        held.push((calendar, id));
    }
    let guest_copy = held.pop();
    let organizer_copy = held.pop();
    match (organizer_copy, guest_copy) {
        (Some(organizer_copy), Some(guest_copy)) => Ok((organizer_copy, guest_copy, provider_id)),
        _ => unreachable!("two calendars were pushed"),
    }
}

/// The writes `user`'s inbox made to Google events.
fn event_writes(stack: &Stack, user: &User) -> Vec<RequestRecord> {
    let mut requests = stack.gmail().requests();
    requests.retain(|request| {
        request.mailbox.as_deref() == Some(user.email())
            && matches!(
                request.route,
                Some(Route::EventsPatch | Route::EventsInsert | Route::EventsDelete)
            )
    });
    requests
}

/// A guest who may not change a meeting is told so when they try to rename
/// it, and nothing is sent to Google. Fails when the change is sent anyway:
/// Google keeps it on the guest's copy only, so the guest sees a title
/// nobody else has. (cal-guest-permissions)
#[tokio::test(flavor = "multi_thread")]
async fn a_guests_rename_is_refused_before_it_reaches_google() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let olga = stack.user("olga").await?;
    let gus = stack.user("gus").await?;
    let (_, (calendar, event_id), provider_id) = review(&stack, &olga, &gus).await?;

    let item = calendar.wait_for_event("Review").await?;
    assert_eq!(
        item["event"]["guestPolicy"],
        json!({ "canModify": false, "canInviteOthers": true, "canSeeOtherGuests": true }),
        "{item}"
    );
    let can = &item["event"]["viewerCan"];
    assert_eq!(
        (
            &can["editDetails"],
            &can["inviteGuests"],
            &can["rsvp"],
            &can["organize"]
        ),
        (&json!(false), &json!(true), &json!(true), &json!(false)),
        "{item}"
    );

    let refused = calendar
        .patch(
            &format!("/events/{event_id}"),
            &json!({ "title": "Review, renamed by a guest" }),
        )
        .await?;
    assert_eq!(refused.status, 403, "{}", refused.text);
    assert_eq!(
        refused.json["code"], "guests_cannot_modify",
        "{}",
        refused.text
    );
    assert_eq!(
        event_writes(&stack, &gus),
        [],
        "the guest's change reached Google"
    );
    for user in [&olga, &gus] {
        let held = stack.gmail().events(user.email(), PRIMARY)?;
        let event = held
            .iter()
            .find(|event| event["id"] == provider_id.as_str());
        assert_eq!(event.map(|event| &event["summary"]), Some(&json!("Review")));
    }

    // Sending the title unchanged with a reminder of the guest's own is not
    // a change to the meeting.
    let own = calendar
        .patch(
            &format!("/events/{event_id}"),
            &json!({
                "title": "Review",
                "reminders": { "useDefault": false, "overrides": [{ "method": "popup", "minutes": 5 }] },
            }),
        )
        .await?;
    assert_eq!(own.status, 200, "{}", own.text);

    stack.finish().await
}

/// When the organizer stops guests from inviting others, a guest's copy
/// says so at once, before the guest's own calendar syncs again, and the
/// guest's invitation is refused without asking Google. Fails when a
/// guest's copy keeps the old permission until its next sync: the guest is
/// offered an action Google will silently drop. (cal-guest-permissions)
#[tokio::test(flavor = "multi_thread")]
async fn an_organizers_guest_policy_reaches_guest_copies_at_once() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let olga = stack.user("olga").await?;
    let gus = stack.user("gus").await?;
    let ((organizer, organizer_event), (guest, guest_event), provider_id) =
        review(&stack, &olga, &gus).await?;
    guest.wait_until_synced(gus.email()).await?;

    // The guest's own sync is held back, so only the organizer's change can
    // carry the new policy to the guest's copy.
    stack.gmail().inject_fault(Fault {
        mailbox: Some(gus.email().to_owned()),
        route: Some(Route::EventsList),
        error: Some(FaultError::Unavailable),
        ..Fault::default()
    });
    let changed = organizer
        .patch(
            &format!("/events/{organizer_event}"),
            &json!({ "guestPolicy": {
                "canModify": false, "canInviteOthers": false, "canSeeOtherGuests": true,
            } }),
        )
        .await?
        .ok()?;
    assert_eq!(
        changed["guestPolicy"]["canInviteOthers"], false,
        "{changed}"
    );
    let held = stack.gmail().events(olga.email(), PRIMARY)?;
    let event = held
        .iter()
        .find(|event| event["id"] == provider_id.as_str());
    assert_eq!(
        event.map(|event| &event["guestsCanInviteOthers"]),
        Some(&json!(false))
    );

    let item = eventually(
        "the guest's copy to carry the organizer's policy",
        DEFAULT_TIMEOUT,
        async || {
            let items = guest.occurrences_titled("Review").await?;
            Ok(items
                .into_iter()
                .find(|item| item["event"]["guestPolicy"]["canInviteOthers"] == false))
        },
    )
    .await?;
    assert_eq!(item["event"]["viewerCan"]["inviteGuests"], false, "{item}");
    let before = stack.gmail().requests().len();
    let refused = guest
        .post(
            &format!("/events/{guest_event}/guests"),
            &json!({ "guests": [{ "email": "y@guests.example.com" }] }),
        )
        .await?;
    assert_eq!(refused.status, 403, "{}", refused.text);
    assert_eq!(
        refused.json["code"], "guests_cannot_invite",
        "{}",
        refused.text
    );
    let asked: Vec<_> = stack
        .gmail()
        .requests()
        .split_off(before)
        .into_iter()
        .filter(|request| {
            request.mailbox.as_deref() == Some(gus.email())
                && matches!(request.route, Some(Route::EventsGet | Route::EventsPatch))
        })
        .collect();
    assert_eq!(asked, [], "the refusal asked Google");

    stack.gmail().clear_faults();
    stack.finish().await
}
