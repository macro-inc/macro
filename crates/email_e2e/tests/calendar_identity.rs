//! Which of a user's inboxes a calendar action is taken as.

use email_e2e::gmail_emulator::{Route, SeedCalendar, SeedMailbox};
use email_e2e::{Provider, Report, Stack, StackOptions, events};
use serde_json::{Value, json};

/// Google's id for a user's own calendar.
const PRIMARY: &str = "primary";

async fn calendar_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await
}

fn add_google_mailbox(stack: &Stack, email: &str) -> Result<(), Report> {
    stack.gmail().add_mailbox(&SeedMailbox {
        email: email.to_owned(),
        ..Default::default()
    })?;
    Ok(())
}

/// The answer Google holds for the guest `email` of `event`.
fn answer_of<'a>(event: &'a Value, email: &str) -> &'a str {
    let guests = event["attendees"].as_array();
    let guest = guests
        .into_iter()
        .flatten()
        .find(|guest| guest["email"] == email);
    guest
        .and_then(|guest| guest["responseStatus"].as_str())
        .unwrap_or_default()
}

fn organizers_event(stack: &Stack, organizer: &str, id: &str) -> Result<Value, Report> {
    let held = stack.gmail().events(organizer, PRIMARY)?;
    let event = held.iter().find(|event| event["id"] == id).cloned();
    Ok(event.unwrap_or_else(|| panic!("the organizer holds no event {id}: {held:?}")))
}

/// A user invited at two of their addresses who answers from one inbox's
/// calendar answers as that inbox, also when the request does not say
/// which address answers. Fails when the answer goes out as whichever of
/// the user's addresses the guest list names first: the wrong guest is
/// answered, or Google refuses the change. (cal-acting-inbox-identity)
#[tokio::test(flavor = "multi_thread")]
async fn an_answer_without_an_address_is_given_as_the_copys_own_inbox() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let work = "ada.work@example.com";
    let organizer = "olga@example.com";
    add_google_mailbox(&stack, organizer)?;
    add_google_mailbox(&stack, ada.email())?;
    let meeting = events::google_with(
        "Sync",
        events::hour_in_days(2),
        json!({ "attendees": [
            { "email": organizer, "responseStatus": "accepted" },
            { "email": work },
            { "email": ada.email() },
        ] }),
    );
    let seeded = stack.gmail().add_event(organizer, PRIMARY, meeting)?;
    let provider_id = seeded["id"].as_str().unwrap_or_default();
    ada.link(Provider::Outlook, work).await?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Sync").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default();

    let answered = calendar
        .put(
            &format!("/events/{event_id}/rsvp"),
            &json!({ "response": "accepted" }),
        )
        .await?;
    assert_eq!(answered.status, 200, "{}", answered.text);
    let held = organizers_event(&stack, organizer, provider_id)?;
    assert_eq!(answer_of(&held, ada.email()), "accepted", "{held}");
    assert_eq!(answer_of(&held, work), "needsAction", "{held}");

    // An address that is not the user's cannot be answered for.
    let foreign = calendar
        .put(
            &format!("/events/{event_id}/rsvp"),
            &json!({ "respondingEmail": organizer, "response": "declined" }),
        )
        .await?;
    assert_eq!(foreign.status, 409, "{}", foreign.text);
    assert_eq!(foreign.json["code"], "not_attendee", "{}", foreign.text);
    let held = organizers_event(&stack, organizer, provider_id)?;
    assert_eq!(answer_of(&held, organizer), "accepted", "{held}");

    stack.finish().await
}

/// A meeting organized by a shared calendar the user can write is the
/// user's to change, from their own copy of it too: the change is made on
/// the organizing calendar. Fails when the user is treated as a mere guest
/// of their own team calendar's meeting and the rename is refused.
/// (cal-acting-inbox-identity)
#[tokio::test(flavor = "multi_thread")]
async fn a_meeting_organized_by_a_writable_calendar_is_the_users_to_change() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_google_mailbox(&stack, ada.email())?;
    let team: SeedCalendar =
        serde_json::from_value(json!({ "secondary": true, "summary": "Team", "selected": true }))?;
    let team = stack.gmail().add_calendar(ada.email(), &team)?;
    let meeting = events::google_with(
        "Team",
        events::hour_in_days(2),
        json!({
            "guestsCanModify": false,
            "attendees": [{ "email": ada.email() }, { "email": "g1@guests.example.com" }],
        }),
    );
    let seeded = stack.gmail().add_event(ada.email(), &team, meeting)?;
    let provider_id = seeded["id"].as_str().unwrap_or_default();
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Team").await?;
    let event = &item["event"];
    assert_eq!(event["viewerCan"]["organize"], true, "{item}");
    assert_eq!(event["viewerCan"]["editDetails"], true, "{item}");

    let event_id = event["id"].as_str().unwrap_or_default();
    let renamed = calendar
        .patch(
            &format!("/events/{event_id}"),
            &json!({ "title": "Team, renamed" }),
        )
        .await?;
    assert_eq!(renamed.status, 200, "{}", renamed.text);
    let held = stack.gmail().events(ada.email(), &team)?;
    let on_team = held.iter().find(|event| event["id"] == provider_id);
    assert_eq!(
        on_team.map(|event| &event["summary"]),
        Some(&json!("Team, renamed")),
        "{held:?}"
    );
    let patches: Vec<_> = stack
        .gmail()
        .requests()
        .into_iter()
        .filter(|request| request.route == Some(Route::EventsPatch))
        .collect();
    assert_eq!(patches.len(), 1, "{patches:?}");

    stack.finish().await
}
