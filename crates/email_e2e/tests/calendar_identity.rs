//! Which of a user's inboxes a calendar action is taken as.

use email_e2e::gmail_emulator::{Route, SeedCalendar, SeedMailbox};
use email_e2e::chrono::{DateTime, Duration, Utc};
use email_e2e::{
    DEFAULT_TIMEOUT, Inbox, Mail, Provider, Report, Stack, StackOptions, events, eventually,
};
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

/// A change made through the organizing calendar shows on the user's
/// calendar at once, while Google has not carried it to the user's own copy
/// yet, and stays after Google has. Fails when the change the user just
/// saved snaps back to the old content until Google catches up, 15 to 30
/// seconds later. (web-cal-mutation-completion)
#[tokio::test(flavor = "multi_thread")]
async fn a_change_through_the_organizing_calendar_shows_before_google_carries_it()
-> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_google_mailbox(&stack, ada.email())?;
    let team: SeedCalendar =
        serde_json::from_value(json!({ "secondary": true, "summary": "Team", "selected": true }))?;
    let team = stack.gmail().add_calendar(ada.email(), &team)?;
    let meeting = events::google_with(
        "Team",
        events::hour_in_days(2),
        json!({ "attendees": [{ "email": ada.email(), "responseStatus": "accepted" }] }),
    );
    let seeded = stack.gmail().add_event(ada.email(), &team, meeting)?;
    let provider_id = seeded["id"].as_str().unwrap_or_default();
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let both_copies = |items: &[Value]| {
        items.iter().any(|item| {
            item["event"]["title"] == "Team"
                && item["event"]["sources"].as_array().map(Vec::len) == Some(2)
        })
    };
    let items = calendar
        .wait_for_occurrences("the meeting to show with both of its copies", both_copies)
        .await?;
    let event_id = items
        .iter()
        .find(|item| item["event"]["title"] == "Team")
        .and_then(|item| item["event"]["id"].as_str())
        .unwrap_or_default()
        .to_owned();
    calendar.wait_until_synced(ada.email()).await?;

    stack.gmail().hold_event_copies();
    let renamed = calendar
        .patch(
            &format!("/events/{event_id}"),
            &json!({ "title": "Team, renamed" }),
        )
        .await?
        .ok()?;
    assert_eq!(renamed["title"], "Team, renamed", "{renamed}");
    let own_copy = organizers_event(&stack, ada.email(), provider_id)?;
    assert_eq!(own_copy["summary"], "Team", "Google carried the change");
    let titles = |items: &[Value]| -> Vec<String> {
        items
            .iter()
            .filter_map(|item| item["event"]["title"].as_str().map(str::to_owned))
            .collect()
    };
    let shown = calendar.occurrences().await?;
    assert_eq!(titles(&shown), ["Team, renamed"], "{shown:?}");

    // Google carries the change; the sync it starts keeps the new content.
    let listings = || {
        let requests = stack.gmail().requests();
        requests
            .iter()
            .filter(|request| request.route == Some(Route::EventsList))
            .count()
    };
    let before = listings();
    stack.gmail().release_event_copies();
    eventually(
        "the sync Google's change starts",
        DEFAULT_TIMEOUT,
        async || Ok((listings() > before).then_some(())),
    )
    .await?;
    calendar.wait_until_synced(ada.email()).await?;
    let shown = calendar.occurrences().await?;
    assert_eq!(titles(&shown), ["Team, renamed"], "{shown:?}");

    stack.finish().await
}

/// The calendar file of the meeting `uid`, as an invitation mail carries it.
fn invitation_file(uid: &str, start: DateTime<Utc>, organizer: &str, guests: &[&str]) -> String {
    let at = |time: DateTime<Utc>| time.format("%Y%m%dT%H%M%SZ").to_string();
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_owned(),
        "VERSION:2.0".to_owned(),
        "PRODID:-//Google Inc//Google Calendar 70.9054//EN".to_owned(),
        "METHOD:REQUEST".to_owned(),
        "BEGIN:VEVENT".to_owned(),
        format!("UID:{uid}"),
        format!("DTSTAMP:{}", at(start - Duration::days(1))),
        format!("DTSTART:{}", at(start)),
        format!("DTEND:{}", at(start + Duration::hours(1))),
        "SUMMARY:Sync".to_owned(),
        "SEQUENCE:0".to_owned(),
        format!("ORGANIZER:mailto:{organizer}"),
    ];
    for guest in guests {
        lines.push(format!(
            "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{guest}"
        ));
    }
    lines.extend(["END:VEVENT".to_owned(), "END:VCALENDAR".to_owned()]);
    lines.join("\r\n") + "\r\n"
}

/// The UID Exchange gives its copy of a meeting made elsewhere: the
/// original UID, wrapped.
fn exchange_uid(uid: &str) -> String {
    let wrapped: String = uid.bytes().map(|byte| format!("{byte:02X}")).collect();
    format!(
        "040000008200E00074C5B7101A82E008{}7643616C2D55696401000000{wrapped}00",
        "0".repeat(48)
    )
}

/// The one invitation card of the thread `thread_id`, as the mail view
/// asks for it.
async fn invitation_card(inbox: &Inbox, thread_id: &str) -> Result<Value, Report> {
    eventually(
        "the invitation card to find the meeting",
        DEFAULT_TIMEOUT,
        async || {
            let cards = inbox
                .get(&format!("/email/threads/{thread_id}/calendar-invitations"))
                .await?
                .ok()?;
            let card = cards.as_object().and_then(|cards| cards.values().next());
            Ok(card
                .filter(|card| card["kind"] != "still_syncing" && card["kind"] != "no_match")
                .cloned())
        },
    )
    .await
}

/// A user invited at two of their inboxes who opens the invitation mail in
/// one of them answers as that inbox: the card names that inbox's copy of
/// the meeting, here an Outlook copy of a Google meeting. Fails when the
/// card cannot tell the two copies apart and offers no answer, or answers
/// as the other inbox. (cal-acting-inbox-identity)
#[tokio::test(flavor = "multi_thread")]
async fn an_invitation_card_answers_as_the_inbox_its_mail_arrived_in() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let work = "ada.work@example.com";
    let organizer = "olga@example.com";
    add_google_mailbox(&stack, organizer)?;
    add_google_mailbox(&stack, ada.email())?;
    stack
        .outlook()
        .add_mailbox(&email_e2e::outlook_emulator::SeedMailbox {
            email: work.to_owned(),
            ..Default::default()
        })?;
    let start = events::hour_in_days(2);
    let meeting = events::google_with(
        "Sync",
        start,
        json!({ "id": "sync1", "attendees": [
            { "email": organizer, "responseStatus": "accepted" },
            { "email": work },
            { "email": ada.email() },
        ] }),
    );
    let seeded = stack.gmail().add_event(organizer, PRIMARY, meeting)?;
    let uid = seeded["iCalUID"].as_str().unwrap_or_default().to_owned();
    let exchange_copy = events::outlook_with(
        "Sync",
        start,
        json!({
            "organizer": { "emailAddress": { "address": organizer } },
            "attendees": [
                { "emailAddress": { "address": work }, "type": "required" },
                { "emailAddress": { "address": ada.email() }, "type": "required" },
            ],
            "responseStatus": { "response": "notResponded" },
            "iCalUId": exchange_uid(&uid),
        }),
    );
    let outlook_id = stack.outlook().add_event(work, "default", &exchange_copy)?;

    let personal = ada.link_gmail_with_calendar().await?;
    let office = ada.link_with_calendar(Provider::Outlook, work).await?;
    let calendar = ada.calendar()?;
    calendar
        .wait_for_occurrences("both copies of the meeting", |items| {
            items
                .iter()
                .filter(|item| item["event"]["title"] == "Sync")
                .flat_map(|item| item["event"]["sources"].as_array().into_iter().flatten())
                .count()
                == 2
        })
        .await?;

    let file = invitation_file(&uid, start, organizer, &[work, ada.email()]);
    stack.outlook().deliver(
        work,
        &email_e2e::outlook_emulator::NewMessage {
            from: Some(format!("Olga <{organizer}>")),
            subject: Some("Invitation: Sync (office)".to_owned()),
            text: Some("You are invited.".to_owned()),
            calendar: Some(file.clone()),
            ..Default::default()
        },
    )?;
    personal.deliver(
        &Mail::new(&format!("Olga <{organizer}>"), "Invitation: Sync (personal)", "You are invited.")
            .with_attachment("invite.ics", "text/calendar; method=REQUEST", file.as_bytes()),
    )?;
    let office_thread = office
        .wait_for_preview("inbox", "Invitation: Sync (office)")
        .await?;
    let personal_thread = personal
        .wait_for_preview("inbox", "Invitation: Sync (personal)")
        .await?;

    let card = invitation_card(&office, office_thread["id"].as_str().unwrap_or_default()).await?;
    assert_eq!(card["kind"], "resolved", "{card}");
    assert_eq!(card["responding_email"], work, "{card}");
    let card_event = card["event"]["id"].as_str().unwrap_or_default();
    let other =
        invitation_card(&personal, personal_thread["id"].as_str().unwrap_or_default()).await?;
    assert_eq!(other["kind"], "resolved", "{other}");
    assert_eq!(other["responding_email"], ada.email(), "{other}");

    // Answering the office card, as the mail view does, answers in Outlook
    // and leaves the Google guest unanswered.
    let answered = calendar
        .put(
            &format!("/events/{card_event}/rsvp"),
            &json!({ "respondingEmail": work, "response": "accepted" }),
        )
        .await?;
    assert_eq!(answered.status, 200, "{}", answered.text);
    let held = stack.outlook().events(work, "default")?;
    let copy = held.iter().find(|event| event["id"] == outlook_id.as_str());
    assert_eq!(
        copy.map(|event| &event["responseStatus"]["response"]),
        Some(&json!("accepted")),
        "{held:?}"
    );
    let at_google = organizers_event(&stack, organizer, "sync1")?;
    assert_eq!(answer_of(&at_google, ada.email()), "needsAction", "{at_google}");

    stack.finish().await
}
