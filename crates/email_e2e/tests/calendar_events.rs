//! Calendar events changed from Macro: what reaches the provider, and what
//! the calendar shows afterwards.

use email_e2e::chrono::{DateTime, Duration, Utc};
use email_e2e::gmail_emulator::SeedMailbox;
use email_e2e::{Calendar, Report, Stack, StackOptions, User, events};
use serde_json::{Value, json};

/// Google's id for a user's own calendar.
const PRIMARY: &str = "primary";
/// The Outlook emulator's name for a mailbox's own calendar.
const DEFAULT: &str = "default";
/// Guests who are not users here.
const GUEST_ONE: &str = "g1@guests.example.com";
const GUEST_TWO: &str = "g2@guests.example.com";
const GUEST_THREE: &str = "g3@guests.example.com";
const GUEST_FOUR: &str = "g4@guests.example.com";

async fn calendar_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await
}

fn add_google_mailbox(stack: &Stack, user: &User) -> Result<(), Report> {
    stack.gmail().add_mailbox(&SeedMailbox {
        email: user.email().to_owned(),
        ..Default::default()
    })?;
    Ok(())
}

fn add_outlook_mailbox(stack: &Stack, user: &User) -> Result<(), Report> {
    stack
        .outlook()
        .add_mailbox(&email_e2e::outlook_emulator::SeedMailbox {
            email: user.email().to_owned(),
            ..Default::default()
        })?;
    Ok(())
}

fn starts_at(item: &Value) -> Option<DateTime<Utc>> {
    item["occurrence"]["time"]["startsAt"]
        .as_str()
        .and_then(|at| at.parse().ok())
}

/// The occurrences of the event `event_id`, earliest first, once there are
/// `count` of them.
async fn occurrences_of(
    calendar: &Calendar,
    event_id: &str,
    count: usize,
) -> Result<Vec<Value>, Report> {
    let of_event = |item: &&Value| item["event"]["id"] == event_id;
    let mut items = calendar
        .wait_for_occurrences(&format!("{count} occurrences of the series"), |items| {
            items.iter().filter(of_event).count() == count
        })
        .await?;
    items.retain(|item| item["event"]["id"] == event_id);
    items.sort_by_key(starts_at);
    Ok(items)
}

/// The event at Google with the id `id`.
fn google_event(stack: &Stack, user: &User, id: &str) -> Result<Value, Report> {
    let events = stack.gmail().events(user.email(), PRIMARY)?;
    let found = events.iter().find(|event| event["id"] == id).cloned();
    Ok(found.unwrap_or_else(|| panic!("Google holds no event {id}: {events:?}")))
}

/// The changed occurrences Google holds of the series `series`.
fn google_exceptions(stack: &Stack, user: &User, series: &str) -> Result<Vec<Value>, Report> {
    let mut events = stack.gmail().events(user.email(), PRIMARY)?;
    events.retain(|event| event["recurringEventId"] == series);
    Ok(events)
}

/// Each guest's address and answer, sorted, as Google holds them.
fn google_guests(event: &Value) -> Vec<(String, String)> {
    let mut guests: Vec<_> = event["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|guest| {
            (
                guest["email"].as_str().unwrap_or_default().to_owned(),
                guest["responseStatus"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect();
    guests.sort();
    guests
}

fn guest(email: &str, answer: &str) -> (String, String) {
    (email.to_owned(), answer.to_owned())
}

/// A daily Google series of six that the user organizes and attends.
async fn daily_series(stack: &Stack, user: &User) -> Result<(Calendar, String, String), Report> {
    add_google_mailbox(stack, user)?;
    let series = events::google_with(
        "Standup",
        events::hour_in_days(1),
        json!({
            "recurrence": ["RRULE:FREQ=DAILY;COUNT=6"],
            "attendees": [
                { "email": user.email(), "responseStatus": "accepted" },
                { "email": GUEST_ONE },
            ],
        }),
    );
    let seeded = stack.gmail().add_event(user.email(), PRIMARY, series)?;
    let provider_id = seeded["id"].as_str().unwrap_or_default().to_owned();
    user.link_gmail_with_calendar().await?;
    let calendar = user.calendar()?;
    let item = calendar.wait_for_event("Standup").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default().to_owned();
    Ok((calendar, event_id, provider_id))
}

fn recurrence_id(item: &Value) -> &str {
    item["occurrence"]["recurrenceId"]
        .as_str()
        .unwrap_or_default()
}

/// Renaming one occurrence of a series renames that occurrence only: the
/// series keeps its title at Google and on the calendar, and the occurrence
/// reads back with the new one. Fails when a change meant for one day lands
/// on the whole series, or when the changed occurrence still shows the
/// series' title. (cal-occurrence-scope)
#[tokio::test(flavor = "multi_thread")]
async fn renaming_one_occurrence_leaves_the_series_alone() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let (calendar, event_id, provider_id) = daily_series(&stack, &ada).await?;
    let occurrences = occurrences_of(&calendar, &event_id, 6).await?;
    let third = recurrence_id(&occurrences[2]).to_owned();

    let renamed = calendar
        .patch(
            &format!("/events/{event_id}"),
            &json!({ "title": "Standup, other room", "scope": "this_event", "recurrenceId": third }),
        )
        .await?
        .ok()?;
    assert_eq!(renamed["title"], "Standup, other room", "{renamed}");

    assert_eq!(
        google_event(&stack, &ada, &provider_id)?["summary"],
        "Standup"
    );
    let exceptions = google_exceptions(&stack, &ada, &provider_id)?;
    let summaries: Vec<_> = exceptions.iter().map(|event| &event["summary"]).collect();
    assert_eq!(summaries, ["Standup, other room"], "{exceptions:?}");

    let listed = calendar
        .wait_for_occurrences("the renamed occurrence", |items| {
            items
                .iter()
                .any(|item| item["event"]["title"] == "Standup, other room")
        })
        .await?;
    let mut titles: Vec<(Option<DateTime<Utc>>, &str)> = listed
        .iter()
        .map(|item| {
            (
                starts_at(item),
                item["event"]["title"].as_str().unwrap_or_default(),
            )
        })
        .collect();
    titles.sort();
    let titles: Vec<_> = titles.into_iter().map(|(_, title)| title).collect();
    assert_eq!(
        titles,
        [
            "Standup",
            "Standup",
            "Standup, other room",
            "Standup",
            "Standup",
            "Standup"
        ]
    );

    stack.finish().await
}

/// Answering one occurrence of a series answers that occurrence only: the
/// user's answer to the series stays as it was, at Google and on every
/// other day. Fails when "maybe" for one day becomes "maybe" for all of
/// them. (cal-occurrence-scope)
#[tokio::test(flavor = "multi_thread")]
async fn answering_one_occurrence_leaves_the_series_answer_alone() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let (calendar, event_id, provider_id) = daily_series(&stack, &ada).await?;
    let occurrences = occurrences_of(&calendar, &event_id, 6).await?;
    let fifth = recurrence_id(&occurrences[4]).to_owned();

    calendar
        .put(
            &format!("/events/{event_id}/rsvp"),
            &json!({ "response": "tentative", "scope": "this_event", "recurrenceId": fifth }),
        )
        .await?
        .ok()?;

    let series = google_event(&stack, &ada, &provider_id)?;
    assert!(
        google_guests(&series).contains(&guest(ada.email(), "accepted")),
        "{series}"
    );
    let exceptions = google_exceptions(&stack, &ada, &provider_id)?;
    assert_eq!(exceptions.len(), 1, "{exceptions:?}");
    assert!(
        google_guests(&exceptions[0]).contains(&guest(ada.email(), "tentative")),
        "{exceptions:?}"
    );

    let own_answer = |item: &Value| -> String {
        let attendees = item["event"]["attendees"].as_array();
        let own = attendees
            .into_iter()
            .flatten()
            .find(|attendee| attendee["isSelf"] == true);
        own.and_then(|attendee| attendee["responseStatus"].as_str())
            .unwrap_or_default()
            .to_owned()
    };
    let listed = calendar
        .wait_for_occurrences("the answered occurrence", |items| {
            items.iter().any(|item| own_answer(item) == "tentative")
        })
        .await?;
    let mut answers: Vec<_> = listed
        .iter()
        .map(|item| (starts_at(item), own_answer(item)))
        .collect();
    answers.sort();
    let answers: Vec<_> = answers.iter().map(|(_, answer)| answer.as_str()).collect();
    assert_eq!(
        answers,
        [
            "accepted",
            "accepted",
            "accepted",
            "accepted",
            "tentative",
            "accepted"
        ]
    );

    stack.finish().await
}

/// Deleting one occurrence of a series removes that day and keeps the
/// rest, at Google and on the calendar. Fails when the delete takes the
/// whole series, or leaves the day in place.
#[tokio::test(flavor = "multi_thread")]
async fn deleting_one_occurrence_keeps_the_rest_of_the_series() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let (calendar, event_id, provider_id) = daily_series(&stack, &ada).await?;
    let occurrences = occurrences_of(&calendar, &event_id, 6).await?;
    let second = &occurrences[1];

    let path = format!(
        "/events/{event_id}?scope=this_event&recurrenceId={}",
        urlencoding::encode(recurrence_id(second))
    );
    calendar.delete(&path).await?.ok()?;

    let left = occurrences_of(&calendar, &event_id, 5).await?;
    assert!(
        !left.iter().any(|item| starts_at(item) == starts_at(second)),
        "{left:?}"
    );
    assert_eq!(
        google_event(&stack, &ada, &provider_id)?["status"],
        "confirmed"
    );
    let exceptions = google_exceptions(&stack, &ada, &provider_id)?;
    let statuses: Vec<_> = exceptions.iter().map(|event| &event["status"]).collect();
    assert_eq!(statuses, ["cancelled"], "{exceptions:?}");

    stack.finish().await
}

/// A Google meeting the user organizes, with one guest who accepted and one
/// who has not answered.
async fn google_meeting(stack: &Stack, user: &User) -> Result<(Calendar, String, String), Report> {
    add_google_mailbox(stack, user)?;
    let meeting = events::google_with(
        "Planning",
        events::hour_in_days(2),
        json!({ "attendees": [
            { "email": user.email(), "responseStatus": "accepted" },
            { "email": GUEST_ONE, "responseStatus": "accepted" },
            { "email": GUEST_TWO },
        ] }),
    );
    let seeded = stack.gmail().add_event(user.email(), PRIMARY, meeting)?;
    let provider_id = seeded["id"].as_str().unwrap_or_default().to_owned();
    user.link_gmail_with_calendar().await?;
    let calendar = user.calendar()?;
    let item = calendar.wait_for_event("Planning").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default().to_owned();
    Ok((calendar, event_id, provider_id))
}

/// Adding a guest to a Google meeting keeps everyone already invited, with
/// their answers. Fails when only the new guest is written: Google reads
/// that as the whole list and uninvites everyone else.
/// (cal-attendee-writes)
#[tokio::test(flavor = "multi_thread")]
async fn adding_a_google_guest_keeps_the_guests_already_invited() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let (calendar, event_id, provider_id) = google_meeting(&stack, &ada).await?;

    let invited = calendar
        .post(
            &format!("/events/{event_id}/guests"),
            &json!({ "guests": [{ "email": GUEST_THREE }] }),
        )
        .await?
        .ok()?;
    assert!(invited["guestPolicy"].is_object(), "{invited}");
    assert!(invited["viewerCan"].is_object(), "{invited}");
    assert_eq!(
        invited["attendees"].as_array().map(Vec::len),
        Some(4),
        "{invited}"
    );

    assert_eq!(
        google_guests(&google_event(&stack, &ada, &provider_id)?),
        [
            guest(ada.email(), "accepted"),
            guest(GUEST_ONE, "accepted"),
            guest(GUEST_TWO, "needsAction"),
            guest(GUEST_THREE, "needsAction"),
        ]
    );

    stack.finish().await
}

/// Replacing a Google meeting's guest list keeps the answers of the guests
/// who stay, adds the new ones and drops the ones left out. Fails when the
/// new list is written without the answers Macro holds: everyone who had
/// accepted is back to "not answered". (cal-attendee-writes)
#[tokio::test(flavor = "multi_thread")]
async fn replacing_the_google_guest_list_keeps_the_answers_of_those_who_stay() -> Result<(), Report>
{
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let (calendar, event_id, provider_id) = google_meeting(&stack, &ada).await?;

    calendar
        .patch(
            &format!("/events/{event_id}"),
            &json!({ "attendees": [
                { "email": ada.email() },
                { "email": GUEST_ONE },
                { "email": GUEST_FOUR },
            ] }),
        )
        .await?
        .ok()?;

    assert_eq!(
        google_guests(&google_event(&stack, &ada, &provider_id)?),
        [
            guest(ada.email(), "accepted"),
            guest(GUEST_ONE, "accepted"),
            guest(GUEST_FOUR, "needsAction"),
        ]
    );

    stack.finish().await
}

/// A meeting created in Macro with guests lists its organizer as a guest
/// who accepted, as Google Calendar itself does. Fails when the organizer
/// is left off the list: guests see a meeting nobody is hosting, and the
/// organizer cannot answer it. (cal-attendee-writes)
#[tokio::test(flavor = "multi_thread")]
async fn a_meeting_created_with_guests_lists_its_organizer_as_accepted() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_google_mailbox(&stack, &ada)?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;

    let start = events::hour_in_days(1);
    calendar
        .post(
            "/events",
            &json!({
                "title": "Kickoff",
                "time": {
                    "kind": "timed",
                    "startsAt": start.to_rfc3339(),
                    "endsAt": (start + Duration::hours(1)).to_rfc3339(),
                    "timeZone": "UTC",
                },
                "attendees": [{ "email": GUEST_ONE }],
            }),
        )
        .await?
        .ok()?;

    let at_google = stack.gmail().events(ada.email(), PRIMARY)?;
    let kickoff = at_google.iter().find(|event| event["summary"] == "Kickoff");
    let kickoff = kickoff.unwrap_or_else(|| panic!("Google holds no Kickoff: {at_google:?}"));
    assert_eq!(
        google_guests(kickoff),
        [
            guest(ada.email(), "accepted"),
            guest(GUEST_ONE, "needsAction")
        ]
    );
    let item = calendar.wait_for_event("Kickoff").await?;
    assert_eq!(
        item["event"]["attendees"].as_array().map(Vec::len),
        Some(2),
        "{item}"
    );

    stack.finish().await
}

/// Adding a guest to an Outlook meeting keeps everyone already invited,
/// with their answers. Fails when only the new guest is written: Outlook
/// reads that as the whole list and uninvites everyone else.
/// (cal-attendee-writes)
#[tokio::test(flavor = "multi_thread")]
async fn adding_an_outlook_guest_keeps_the_guests_already_invited() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_outlook_mailbox(&stack, &ada)?;
    let required =
        |email: &str| json!({ "emailAddress": { "address": email }, "type": "required" });
    let meeting = events::outlook_with(
        "Planning",
        events::hour_in_days(2),
        json!({ "attendees": [required(GUEST_ONE), required(GUEST_TWO)] }),
    );
    let id = stack.outlook().add_event(ada.email(), DEFAULT, &meeting)?;
    stack
        .outlook()
        .answer_event(ada.email(), &id, GUEST_ONE, "accepted")?;
    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Planning").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default();

    calendar
        .post(
            &format!("/events/{event_id}/guests"),
            &json!({ "guests": [{ "email": GUEST_THREE }] }),
        )
        .await?
        .ok()?;

    let at_outlook = stack.outlook().events(ada.email(), DEFAULT)?;
    let planning = at_outlook
        .iter()
        .find(|event| event["subject"] == "Planning");
    let planning = planning.unwrap_or_else(|| panic!("Outlook holds no Planning: {at_outlook:?}"));
    let mut guests: Vec<(String, String)> = planning["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|attendee| {
            (
                attendee["emailAddress"]["address"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
                attendee["status"]["response"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect();
    guests.sort();
    assert_eq!(
        guests,
        [
            guest(GUEST_ONE, "accepted"),
            guest(GUEST_TWO, "none"),
            guest(GUEST_THREE, "none"),
        ]
    );

    stack.finish().await
}

/// Deleting "this and the following" occurrences of a series that was
/// meanwhile deleted at Google succeeds and takes the series off the
/// calendar: there is nothing left to shorten. Fails when Macro tries to
/// shorten the deleted series, Google refuses, and the user is left with a
/// series they cannot delete. (cal-split-series-comes-back)
#[tokio::test(flavor = "multi_thread")]
async fn deleting_the_rest_of_a_series_already_deleted_at_google_succeeds() -> Result<(), Report> {
    use email_e2e::gmail_emulator::{Fault, FaultError, Route};

    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let (calendar, event_id, provider_id) = daily_series(&stack, &ada).await?;
    let occurrences = occurrences_of(&calendar, &event_id, 6).await?;
    let third = recurrence_id(&occurrences[2]).to_owned();
    calendar.wait_until_synced(ada.email()).await?;

    // Sync is held back, so Macro still shows the series Google deleted.
    stack.gmail().inject_fault(Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(Route::EventsList),
        error: Some(FaultError::Unavailable),
        ..Fault::default()
    });
    stack
        .gmail()
        .delete_event(ada.email(), PRIMARY, &provider_id)?;

    let path = format!(
        "/events/{event_id}?scope=this_and_following&recurrenceId={}",
        urlencoding::encode(&third)
    );
    let deleted = calendar.delete(&path).await?;
    assert_eq!(deleted.status, 204, "{}", deleted.text);
    let refused: Vec<_> = stack
        .gmail()
        .requests()
        .into_iter()
        .filter(|request| request.route == Some(Route::EventsPatch))
        .collect();
    assert_eq!(refused, [], "Macro tried to change the deleted series");
    calendar.wait_until_gone("Standup").await?;

    stack.gmail().clear_faults();
    stack.finish().await
}
