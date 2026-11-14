//! Outlook calendars: what a real mailbox holds that Graph's own writes
//! never make must not stop the calendar from syncing.

use email_e2e::chrono::{DateTime, Duration, Utc};
use email_e2e::outlook_emulator::SeedMailbox;
use email_e2e::{Report, Stack, StackOptions, User, events};
use serde_json::{Value, json};

/// The Outlook emulator's name for a mailbox's own calendar.
const DEFAULT: &str = "default";

async fn calendar_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await
}

fn add_mailbox(stack: &Stack, user: &User) -> Result<(), Report> {
    stack.outlook().add_mailbox(&SeedMailbox {
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

/// An Outlook event Macro cannot read (here a series repeating every zero
/// days, as imported calendars hold) is left out, and everything else on
/// the calendar syncs, on the first import and afterwards. Fails when one
/// such event fails the whole calendar: it never finishes syncing and
/// every event after the bad one is missing.
/// (cal-outlook-one-bad-item-blocks-sync)
#[tokio::test(flavor = "multi_thread")]
async fn an_unreadable_outlook_event_does_not_block_its_calendar() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_mailbox(&stack, &ada)?;
    let day = events::hour_in_days(2);
    let before = events::outlook("Before", day);
    stack.outlook().add_event(ada.email(), DEFAULT, &before)?;
    let unreadable = events::outlook_with(
        "Imported series",
        day + Duration::hours(2),
        json!({ "raw": { "recurrence": {
            "pattern": { "type": "daily", "interval": 0 },
            "range": { "type": "noEnd", "startDate": day.date_naive().to_string() },
        } } }),
    );
    stack
        .outlook()
        .add_event(ada.email(), DEFAULT, &unreadable)?;
    let after = events::outlook("After", day + Duration::hours(4));
    stack.outlook().add_event(ada.email(), DEFAULT, &after)?;

    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Before").await?;
    calendar.wait_for_event("After").await?;

    let later = events::outlook("Later", day + Duration::hours(6));
    stack.outlook().add_event(ada.email(), DEFAULT, &later)?;
    calendar.poll_outlook_now(ada.email()).await?;
    calendar.wait_for_event("Later").await?;
    let mut titles: Vec<String> = calendar
        .occurrences()
        .await?
        .iter()
        .filter_map(|item| item["event"]["title"].as_str().map(str::to_owned))
        .collect();
    titles.sort();
    assert_eq!(titles, ["After", "Before", "Later"]);

    stack.finish().await
}

/// A mailbox whose time zone is one Macro has no name for (a customised
/// zone) still has its calendars found and its events imported. Fails when
/// the unknown zone fails calendar discovery: the user's Outlook calendar
/// stays empty. (cal-outlook-one-bad-item-blocks-sync)
#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_outlook_mailbox_time_zone_does_not_block_discovery() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_mailbox(&stack, &ada)?;
    stack
        .outlook()
        .set_time_zone(ada.email(), "Customized Time Zone")?;
    let standup = events::outlook("Standup", events::hour_in_days(1));
    stack.outlook().add_event(ada.email(), DEFAULT, &standup)?;

    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Standup").await?;
    let listed = calendar.get("/calendars").await?.ok()?;
    assert_eq!(
        listed["calendars"].as_array().map(Vec::len),
        Some(1),
        "{listed}"
    );

    stack.finish().await
}

/// An occurrence of an Outlook series that was moved to another day shows
/// once, at its new time, and not at the slot the series would put it on.
/// Fails when moved occurrences are not paired with their slot: the
/// occurrence is missing, or shows at the old time.
/// (cal-outlook-one-bad-item-blocks-sync)
#[tokio::test(flavor = "multi_thread")]
async fn a_moved_outlook_occurrence_shows_at_its_new_time() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_mailbox(&stack, &ada)?;
    let first = events::hour_in_days(2);
    let slot = first + Duration::days(1);
    let moved_to = slot + Duration::hours(5);
    let series = events::outlook_with(
        "Daily",
        first,
        json!({
            "recurrence": {
                "pattern": { "type": "daily", "interval": 1 },
                "range": {
                    "type": "numbered",
                    "startDate": first.date_naive().to_string(),
                    "numberOfOccurrences": 4,
                },
            },
            "exceptions": [{
                "date": slot.date_naive().to_string(),
                "subject": "Daily (moved)",
                "start": events::graph_time(moved_to),
                "end": events::graph_time(moved_to + Duration::hours(1)),
            }],
        }),
    );
    stack.outlook().add_event(ada.email(), DEFAULT, &series)?;

    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    let items = calendar
        .wait_for_occurrences("the four occurrences of the series", |items| {
            items.len() >= 4
        })
        .await?;
    let mut starts: Vec<_> = items.iter().filter_map(starts_at).collect();
    starts.sort();
    assert_eq!(
        starts,
        [
            first,
            moved_to,
            first + Duration::days(2),
            first + Duration::days(3)
        ],
        "{items:?}"
    );

    stack.finish().await
}

/// The organizer of an Outlook meeting shows as having accepted it, and is
/// not offered an answer: Outlook lists the organizer among the guests
/// with no answer, and does not let them give one. Fails when the
/// organizer shows as "not answered" on their own meeting, or is offered
/// answer buttons that can only fail.
/// (cal-outlook-organizer-and-exchange-ids)
#[tokio::test(flavor = "multi_thread")]
async fn an_outlook_organizer_shows_as_accepted_and_cannot_answer() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_mailbox(&stack, &ada)?;
    let required =
        |email: &str| json!({ "emailAddress": { "address": email }, "type": "required" });
    let meeting = events::outlook_with(
        "Planning",
        events::hour_in_days(2),
        json!({ "attendees": [required(ada.email()), required("guest@guests.example.com")] }),
    );
    stack.outlook().add_event(ada.email(), DEFAULT, &meeting)?;

    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Planning").await?;
    let event = &item["event"];
    let own = event["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|attendee| attendee["isSelf"] == true);
    let own = own.unwrap_or_else(|| panic!("the organizer is not among the guests: {item}"));
    assert_eq!(own["responseStatus"], "accepted", "{item}");
    assert_eq!(event["viewerCan"]["organize"], true, "{item}");
    assert_eq!(event["viewerCan"]["rsvp"], false, "{item}");

    let event_id = event["id"].as_str().unwrap_or_default();
    let answered = calendar
        .put(
            &format!("/events/{event_id}/rsvp"),
            &json!({ "response": "accepted" }),
        )
        .await?;
    assert_eq!(answered.status, 409, "{}", answered.text);

    stack.finish().await
}
