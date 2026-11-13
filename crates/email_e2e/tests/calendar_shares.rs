//! Calendar events shared into channels, and booking links.

use email_e2e::chrono::{DateTime, Duration, Utc};
use email_e2e::gmail_emulator::{SeedCalendar, SeedMailbox};
use email_e2e::{Calendar, DEFAULT_TIMEOUT, Report, Stack, StackOptions, User, events, eventually};
use serde_json::{Value, json};
use uuid::Uuid;

/// Google's id for a user's own calendar.
const PRIMARY: &str = "primary";

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

/// Shares the event `event_id` into a new channel of `owner`'s that
/// `member` is in, as posting the event in the channel does.
async fn share_in_channel(
    stack: &Stack,
    owner: &User,
    member: &User,
    event_id: Uuid,
) -> Result<Uuid, Report> {
    let channel = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comms_channels (id, channel_type, owner_id) \
         VALUES ($1, 'private'::comms_channel_type, $2)",
    )
    .bind(channel)
    .bind(owner.macro_id())
    .execute(stack.db())
    .await?;
    for (user, role) in [(owner, "owner"), (member, "member")] {
        sqlx::query(
            "INSERT INTO comms_channel_participants (channel_id, user_id, role) \
             VALUES ($1, $2, $3::comms_participant_role)",
        )
        .bind(channel)
        .bind(user.macro_id())
        .bind(role)
        .execute(stack.db())
        .await?;
    }
    sqlx::query(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) \
         VALUES ($1, 'calendar_event', $2, 'channel', 'view')",
    )
    .bind(event_id)
    .bind(channel.to_string())
    .execute(stack.db())
    .await?;
    Ok(channel)
}

/// What the chip of the event `event_id` shows `viewer`.
async fn preview(viewer: &Calendar, event_id: &str) -> Result<Value, Report> {
    let body = json!({ "items": [{ "eventId": event_id, "occurrenceKey": null }] });
    let previews = viewer
        .read(
            reqwest::Method::POST,
            "/calendar-events/preview",
            Some(&body),
        )
        .await?
        .ok()?;
    Ok(previews["items"][0].clone())
}

/// An event shared in a channel shows there to a member who is not
/// invited, and when the event is deleted its share goes with it: the chip
/// says the event no longer exists and no grant is left behind. Fails when
/// deleting the event leaves the channel's grant in place, pointing at
/// nothing. (cal-delete-leaves-shares-and-chips)
#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_shared_event_removes_its_channel_share() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let ben = stack.user("ben").await?;
    for user in [&ada, &ben] {
        add_google_mailbox(&stack, user)?;
    }
    let offsite = events::google("Offsite", events::hour_in_days(2));
    let seeded = stack.gmail().add_event(ada.email(), PRIMARY, offsite)?;
    ada.link_gmail_with_calendar().await?;
    ben.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Offsite").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default().to_owned();
    share_in_channel(&stack, &ada, &ben, event_id.parse()?).await?;

    let shown = preview(&ben.calendar()?, &event_id).await?;
    assert_eq!(shown["type"], "access", "{shown}");
    assert_eq!(shown["event"]["title"], "Offsite", "{shown}");

    calendar.wait_until_synced(ada.email()).await?;
    let provider_id = seeded["id"].as_str().unwrap_or_default();
    stack
        .gmail()
        .delete_event(ada.email(), PRIMARY, provider_id)?;
    calendar.wait_until_gone("Offsite").await?;

    let gone = preview(&ben.calendar()?, &event_id).await?;
    assert_eq!(gone["type"], "does_not_exist", "{gone}");
    let grants: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM entity_access \
         WHERE entity_type = 'calendar_event' AND entity_id = $1",
    )
    .bind(event_id.parse::<Uuid>()?)
    .fetch_one(stack.db())
    .await?;
    assert_eq!(grants, 0, "the channel's grant outlived the event");

    stack.finish().await
}

/// The start times a booking link offers on the day of `day`.
async fn offered(
    calendar: &Calendar,
    link: &Value,
    day: DateTime<Utc>,
) -> Result<Vec<DateTime<Utc>>, Report> {
    let path = format!(
        "/scheduling/public/{}/{}/slots?date={}&timeZone=UTC",
        link["profileId"].as_str().unwrap_or_default(),
        link["eventTypeId"].as_str().unwrap_or_default(),
        day.date_naive()
    );
    let slots = calendar.get(&path).await?.ok()?;
    Ok(slots["slots"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|slot| slot["startsAt"].as_str()?.parse().ok())
        .collect())
}

/// A booking link offers the times its host is free on the calendars that
/// count toward their availability: an event on a calendar the host
/// switched off for availability does not block its time, one on a
/// calendar that counts does. Fails when every calendar blocks booking
/// whatever the host chose. (cal-booking-counts-every-calendar)
#[tokio::test(flavor = "multi_thread")]
async fn a_booking_link_ignores_calendars_that_do_not_count_toward_availability()
-> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_google_mailbox(&stack, &ada)?;
    let side: SeedCalendar =
        serde_json::from_value(json!({ "secondary": true, "summary": "Side", "selected": true }))?;
    let side = stack.gmail().add_calendar(ada.email(), &side)?;
    let day = events::hour_in_days(3);
    let ten = day
        .date_naive()
        .and_hms_opt(10, 0, 0)
        .map_or(day, |at| at.and_utc());
    let half_hour = |title: &str, start: DateTime<Utc>| {
        events::google_with(
            title,
            start,
            json!({ "end": { "dateTime": (start + Duration::minutes(30)).to_rfc3339() } }),
        )
    };
    stack
        .gmail()
        .add_event(ada.email(), &side, half_hour("Side work", ten))?;
    let eleven = ten + Duration::hours(1);
    stack
        .gmail()
        .add_event(ada.email(), PRIMARY, half_hour("Dentist", eleven))?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Side work").await?;
    calendar.wait_for_event("Dentist").await?;
    calendar.wait_until_synced(ada.email()).await?;

    let weekly: Vec<Value> = (0..7)
        .map(|day| json!({ "day": day, "windows": [{ "start": "09:00", "end": "17:00" }] }))
        .collect();
    let link = calendar
        .post(
            "/scheduling/links",
            &json!({
                "draft": {
                    "event": {
                        "title": "Intro", "slug": "intro", "description": "",
                        "durationMinutes": 30, "location": "", "googleMeet": false,
                        "enabled": true, "mode": "individual", "hosts": [ada.macro_id()],
                        "beforeMinutes": 0, "afterMinutes": 0, "noticeMinutes": 0,
                        "horizonDays": 30, "intervalMinutes": 30, "dailyLimit": null,
                        "requiresConfirmation": false, "questions": [],
                    },
                    "schedule": { "name": "Work", "timeZone": "UTC", "weekly": weekly, "overrides": [] },
                },
                "userConfirmation": "yes",
            }),
        )
        .await?
        .ok()?;

    let before = offered(&calendar, &link, day).await?;
    assert!(
        before.contains(&(ten + Duration::minutes(30))),
        "{before:?}"
    );
    assert!(!before.contains(&ten), "{before:?}");
    assert!(!before.contains(&eleven), "{before:?}");

    let calendars = calendar.get("/availability-calendars").await?.ok()?;
    let side_id = calendars["calendars"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|calendar| calendar["name"] == "Side")
        .and_then(|calendar| calendar["calendarId"].as_str())
        .unwrap_or_else(|| panic!("no Side calendar: {calendars}"))
        .to_owned();
    let switched = calendar
        .put(
            &format!("/availability-calendars/{side_id}"),
            &json!({ "contributesToAvailability": false }),
        )
        .await?;
    assert_eq!(switched.status, 204, "{}", switched.text);

    let after = offered(&calendar, &link, day).await?;
    assert!(after.contains(&ten), "{after:?}");
    assert!(!after.contains(&eleven), "{after:?}");

    stack.finish().await
}

/// Ada's Google meeting with an outside guest, shared into a channel Ben
/// is in. Returns Ada's and Ben's calendars and the event's id.
async fn shared_offsite(
    stack: &Stack,
    ada: &User,
    ben: &User,
) -> Result<(Calendar, Calendar, String), Report> {
    for user in [ada, ben] {
        add_google_mailbox(stack, user)?;
    }
    let offsite = events::google_with(
        "Offsite",
        events::hour_in_days(2),
        json!({ "attendees": [
            { "email": ada.email(), "responseStatus": "accepted" },
            { "email": "guest@guests.example.com" },
        ] }),
    );
    stack.gmail().add_event(ada.email(), PRIMARY, offsite)?;
    ada.link_gmail_with_calendar().await?;
    ben.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Offsite").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default().to_owned();
    share_in_channel(stack, ada, ben, event_id.parse()?).await?;
    Ok((calendar, ben.calendar()?, event_id))
}

/// Asks, as the calendar's user, to join the shared event.
async fn ask_to_join(calendar: &Calendar, event_id: &str) -> Result<Value, Report> {
    calendar
        .read(
            reqwest::Method::POST,
            &format!("/calendar-events/{event_id}/join-requests"),
            None,
        )
        .await?
        .ok()
}

/// The `events.import` calls `user`'s inbox made to Google.
fn imports(stack: &Stack, user: &User) -> usize {
    let requests = stack.gmail().requests();
    let imports = requests.iter().filter(|request| {
        request.route == Some(email_e2e::gmail_emulator::Route::EventsImport)
            && request.mailbox.as_deref() == Some(user.email())
    });
    imports.count()
}

/// Copying an event shared in a channel puts a copy on the copier's own
/// Google calendar, with the copier as its only guest, and Macro shows it
/// as a copy rather than an invitation. Fails when the copy is written
/// without the copier as a guest: Google refuses it and nothing is copied.
/// (cal-snapshot-and-join-requests)
#[tokio::test(flavor = "multi_thread")]
async fn copying_a_shared_event_puts_a_copy_on_the_copiers_calendar() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let ben = stack.user("ben").await?;
    let (_, bens, event_id) = shared_offsite(&stack, &ada, &ben).await?;

    let copied = bens
        .post(&format!("/events/{event_id}/copy"), &json!({}))
        .await?;
    assert_eq!(copied.status, 201, "{}", copied.text);
    assert_eq!(copied.json["isSnapshot"], true, "{}", copied.text);

    let held = stack.gmail().events(ben.email(), PRIMARY)?;
    let copy = held.iter().find(|event| event["summary"] == "Offsite");
    let copy = copy.unwrap_or_else(|| panic!("Ben's calendar holds no Offsite: {held:?}"));
    let guests: Vec<_> = copy["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|guest| (&guest["email"], &guest["responseStatus"]))
        .collect();
    assert_eq!(
        guests,
        [(&json!(ben.email()), &json!("accepted"))],
        "{copy}"
    );
    let item = bens.wait_for_event("Offsite").await?;
    assert_eq!(item["event"]["isSnapshot"], true, "{item}");

    stack.finish().await
}

/// Someone who asked to join a shared event cannot also copy it while the
/// request is open: the copy is refused and nothing is written to their
/// calendar. Fails when the copy goes through, leaving a copy that the
/// invitation, once the request is accepted, collides with.
/// (cal-snapshot-and-join-requests)
#[tokio::test(flavor = "multi_thread")]
async fn an_event_cannot_be_copied_while_a_request_to_join_it_is_open() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let ben = stack.user("ben").await?;
    let (_, bens, event_id) = shared_offsite(&stack, &ada, &ben).await?;

    let request = ask_to_join(&bens, &event_id).await?;
    assert_eq!(request["status"], "pending", "{request}");

    let copied = bens
        .post(&format!("/events/{event_id}/copy"), &json!({}))
        .await?;
    assert_eq!(copied.status, 409, "{}", copied.text);
    assert_eq!(copied.json["code"], "join_request_open", "{}", copied.text);
    assert_eq!(imports(&stack, &ben), 0);
    assert_eq!(
        stack.gmail().events(ben.email(), PRIMARY)?,
        Vec::<Value>::new()
    );

    stack.finish().await
}

/// What the services told `user`'s open clients about calendars.
fn refreshes_to(stack: &Stack, user: &User) -> Vec<Value> {
    let name = user.email().split('@').next().unwrap_or_default();
    stack
        .service_requests()
        .iter()
        .filter(|request| request.service == "connection-gateway" && request.path.contains(name))
        .filter_map(|request| {
            let body = request.body.as_ref()?;
            (body["message_type"] == "refresh_calendar").then(|| match &body["message"] {
                Value::String(text) => serde_json::from_str(text).unwrap_or(Value::Null),
                message => message.clone(),
            })
        })
        .collect()
}

/// A request to join a shared event reaches the sharer (a notification,
/// and their open calendar reloads), and the answer reaches both sides:
/// the sharer's calendar reloads and the requester's client is told the
/// request was answered. Fails when either side has to reload by hand to
/// see the request or its answer. (cal-snapshot-and-join-requests)
#[tokio::test(flavor = "multi_thread")]
async fn a_request_to_join_and_its_answer_are_announced() -> Result<(), Report> {
    use email_e2e::CalendarSignal;

    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let ben = stack.user("ben").await?;
    let (adas, bens, event_id) = shared_offsite(&stack, &ada, &ben).await?;
    adas.wait_until_synced(ada.email()).await?;

    let request = ask_to_join(&bens, &event_id).await?;
    let request_id = request["id"].as_str().unwrap_or_default();
    let signals = stack.calendar_signals();
    assert!(
        signals.iter().any(|signal| matches!(
            signal,
            CalendarSignal::CalendarChanged { owner_id, .. } if owner_id == ada.macro_id()
        )),
        "{signals:?}"
    );
    assert!(
        signals.iter().any(|signal| matches!(
            signal,
            CalendarSignal::JoinRequestNotification { sharer_id, requester_id, event_title, .. }
                if sharer_id == ada.macro_id()
                    && requester_id == ben.macro_id()
                    && event_title == "Offsite"
        )),
        "{signals:?}"
    );
    let listed = adas
        .read(
            reqwest::Method::GET,
            &format!("/calendar-events/{event_id}/join-requests"),
            None,
        )
        .await?
        .ok()?;
    assert_eq!(listed["requests"][0]["id"], request_id, "{listed}");

    let to_ada = refreshes_to(&stack, &ada).len();
    let answered = adas
        .put(
            &format!("/join-requests/{request_id}"),
            &json!({ "decision": "decline" }),
        )
        .await?
        .ok()?;
    assert_eq!(answered["status"], "declined", "{answered}");
    // The service tells the gateway after it has answered the request.
    eventually(
        "both sides to be told the request was answered",
        DEFAULT_TIMEOUT,
        async || {
            let told_ada = refreshes_to(&stack, &ada).split_off(to_ada);
            let told_ben = refreshes_to(&stack, &ben);
            Ok((told_ada.iter().any(|message| message["event"] == "synced")
                && told_ben
                    .iter()
                    .any(|message| message["event"] == "join_request_answered"))
            .then_some(()))
        },
    )
    .await?;

    stack.finish().await
}

/// The notification of a request to join goes away when the request is
/// answered. Fails when the sharer keeps a notification asking them to
/// answer a request they already answered. (cal-snapshot-and-join-requests)
#[tokio::test(flavor = "multi_thread")]
async fn answering_a_request_to_join_removes_its_notification() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let ben = stack.user("ben").await?;
    let (adas, bens, event_id) = shared_offsite(&stack, &ada, &ben).await?;
    let request = ask_to_join(&bens, &event_id).await?;
    let request_id = request["id"].as_str().unwrap_or_default();

    // The notification service does not run here: this is the row it
    // writes for the request.
    let notification = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, \
                                   service_sender, metadata) \
         VALUES ($1, 'calendar_event_join_request', $2, 'calendar_event', 'notification_service', $3)",
    )
    .bind(notification)
    .bind(&event_id)
    .bind(json!({ "requestId": request_id, "eventId": event_id, "title": "Offsite" }))
    .execute(stack.db())
    .await?;
    sqlx::query(
        "INSERT INTO user_notification (user_id, notification_id, event_item_type, event_item_id, \
                                        notification_event_type) \
         VALUES ($1, $2, 'calendar_event', $3, 'calendar_event_join_request')",
    )
    .bind(ada.macro_id())
    .bind(notification)
    .bind(&event_id)
    .execute(stack.db())
    .await?;

    adas.put(
        &format!("/join-requests/{request_id}"),
        &json!({ "decision": "decline" }),
    )
    .await?
    .ok()?;

    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM notification WHERE id = $1")
        .bind(notification)
        .fetch_one(stack.db())
        .await?;
    assert_eq!(left, 0, "the notification outlived the request's answer");

    stack.finish().await
}

/// The join link of the Macro call an event's organizer attached.
const CALL_URL: &str = "https://macro.com/app/meet/join/0123456789abcdef0123456789abcdef";

/// A Google event with a Macro call attached, as Macro writes it.
fn event_with_call(title: &str) -> email_e2e::gmail_emulator::NewEvent {
    let description = format!(
        "<p>Bring the budget draft</p>\n<p>Join Macro call: <a href=\"{CALL_URL}\">{CALL_URL}</a></p>"
    );
    events::google_with(
        title,
        events::hour_in_days(2),
        json!({ "description": description, "location": CALL_URL }),
    )
}

/// The calendar file of an event leaves out its Macro call link: the file
/// is for people outside the meeting, and the link lets anyone in. The
/// rest of the description stays. Fails when the exported file carries the
/// join link. (cal-invitation-mail)
#[tokio::test(flavor = "multi_thread")]
async fn an_exported_event_file_leaves_out_the_macro_call_link() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_google_mailbox(&stack, &ada)?;
    stack
        .gmail()
        .add_event(ada.email(), PRIMARY, event_with_call("Budget"))?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Budget").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default();

    let file = calendar
        .read(
            reqwest::Method::GET,
            &format!("/calendar-events/{event_id}/ics"),
            None,
        )
        .await?;
    assert_eq!(file.status, 200, "{}", file.text);
    assert!(file.text.contains("BEGIN:VEVENT"), "{}", file.text);
    assert!(
        file.text.contains("Bring the budget draft"),
        "{}",
        file.text
    );
    assert!(!file.text.contains("/meet/join/"), "{}", file.text);

    stack.finish().await
}

/// The chip of an event shared in a channel shows channel members who are
/// not invited the event without its Macro call link; its owner still sees
/// the link. Fails when sharing an event in a channel hands every member
/// the way into the call. (cal-invitation-mail)
#[tokio::test(flavor = "multi_thread")]
async fn a_channel_shared_event_shows_others_no_macro_call_link() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let ben = stack.user("ben").await?;
    for user in [&ada, &ben] {
        add_google_mailbox(&stack, user)?;
    }
    stack
        .gmail()
        .add_event(ada.email(), PRIMARY, event_with_call("Budget"))?;
    ada.link_gmail_with_calendar().await?;
    ben.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Budget").await?;
    let event_id = item["event"]["id"].as_str().unwrap_or_default().to_owned();
    share_in_channel(&stack, &ada, &ben, event_id.parse()?).await?;

    let shown = preview(&ben.calendar()?, &event_id).await?;
    assert_eq!(shown["type"], "access", "{shown}");
    assert_eq!(shown["event"]["title"], "Budget", "{shown}");
    assert!(
        !shown["event"].to_string().contains("/meet/join/"),
        "{shown}"
    );
    assert!(
        shown["event"]["description"]
            .as_str()
            .is_some_and(|description| description.contains("Bring the budget draft")),
        "{shown}"
    );

    let own = preview(&calendar, &event_id).await?;
    assert!(own["event"].to_string().contains("/meet/join/"), "{own}");

    stack.finish().await
}

/// A copy that the organizer later turns into a real invitation stops
/// being a copy: the copier is a guest and can answer. Fails when the event
/// keeps counting as a copy, so the invited user cannot answer their own
/// invitation. (cal-snapshot-and-join-requests)
#[tokio::test(flavor = "multi_thread")]
async fn a_copy_that_becomes_an_invitation_can_be_answered() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let ben = stack.user("ben").await?;
    let (_, bens, event_id) = shared_offsite(&stack, &ada, &ben).await?;
    bens.post(&format!("/events/{event_id}/copy"), &json!({}))
        .await?
        .ok()?;
    let copy = bens.wait_for_event("Offsite").await?;
    assert_eq!(copy["event"]["isSnapshot"], true, "{copy}");
    bens.wait_until_synced(ben.email()).await?;

    // At Google the invitation folds into the copy: the same event now
    // lists the organizer and Ben, who has not answered.
    let held = stack.gmail().events(ben.email(), PRIMARY)?;
    let provider_id = held
        .iter()
        .find(|event| event["summary"] == "Offsite")
        .and_then(|event| event["id"].as_str())
        .unwrap_or_default()
        .to_owned();
    let invited = email_e2e::gmail_emulator::NewEvent::from_json(json!({ "attendees": [
        { "email": ada.email(), "responseStatus": "accepted" },
        { "email": ben.email(), "responseStatus": "needsAction" },
    ] }));
    stack
        .gmail()
        .change_event(ben.email(), PRIMARY, &provider_id, invited)?;
    let items = bens
        .wait_for_occurrences("the copy to become an invitation", |items| {
            items.iter().any(|item| {
                item["event"]["title"] == "Offsite" && item["event"]["isSnapshot"] == false
            })
        })
        .await?;
    let own_id = items
        .iter()
        .find(|item| item["event"]["title"] == "Offsite")
        .and_then(|item| item["event"]["id"].as_str())
        .unwrap_or_default();

    let answered = bens
        .put(
            &format!("/events/{own_id}/rsvp"),
            &json!({ "response": "accepted" }),
        )
        .await?;
    assert_eq!(answered.status, 200, "{}", answered.text);

    stack.finish().await
}
