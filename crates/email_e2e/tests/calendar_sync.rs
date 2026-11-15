//! Calendar sync: what is on a provider's calendar reaches the Macro
//! calendar, on first import and as it changes.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: the scenario's own rows and reads are not checked against the query cache"
)]

use email_e2e::chrono::{DateTime, Duration, Utc};
use email_e2e::gmail_emulator::{Fault, FaultError, NewEvent, RequestRecord, Route, SeedMailbox};
use email_e2e::{DEFAULT_TIMEOUT, Report, Stack, StackOptions, User, events, eventually};
use serde_json::{Value, json};

/// Google's id for a user's own calendar.
const PRIMARY: &str = "primary";
/// The Outlook emulator's name for a mailbox's own calendar.
const DEFAULT: &str = "default";
/// A second Google calendar on the user's list.
const TEAM_CALENDAR: &str = "team@group.calendar.example.com";
/// A calendar Google refuses to watch.
const HOLIDAYS: &str = "holidays@group.calendar.example.com";

async fn calendar_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await
}

/// Creates the user's Gmail mailbox with `calendars`, each the emulator's
/// description of a calendar; one without an id is the primary calendar.
fn seed_google_calendars(stack: &Stack, user: &User, calendars: Value) -> Result<(), Report> {
    let mailbox: SeedMailbox =
        serde_json::from_value(json!({ "email": user.email(), "calendars": calendars }))?;
    stack.gmail().add_mailbox(&mailbox)?;
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

fn titles(items: &[Value]) -> Vec<&str> {
    items
        .iter()
        .filter_map(|item| item["event"]["title"].as_str())
        .collect()
}

/// A Gmail inbox linked with calendar consent shows the events its Google
/// calendar already held, and events added, renamed and deleted at Google
/// afterwards follow through Google's push. Fails when the first import or
/// the push path (watch channel, webhook, incremental sync) is broken.
#[tokio::test(flavor = "multi_thread")]
async fn google_events_arrive_on_import_and_by_push() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    seed_google_calendars(&stack, &ada, json!([]))?;
    let standup = events::hour_in_days(1);
    let seeded =
        stack
            .gmail()
            .add_event(ada.email(), PRIMARY, events::google("Standup", standup))?;

    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let item = calendar.wait_for_event("Standup").await?;
    assert_eq!(
        item["occurrence"]["time"]["startsAt"]
            .as_str()
            .and_then(|at| at.parse::<DateTime<Utc>>().ok()),
        Some(standup),
        "{item}"
    );

    let retro = events::google("Retro", events::hour_in_days(2));
    stack.gmail().add_event(ada.email(), PRIMARY, retro)?;
    calendar.wait_for_event("Retro").await?;
    calendar.wait_until_synced(ada.email()).await?;

    let id = seeded["id"].as_str().unwrap_or_default();
    let rename = NewEvent::from_json(json!({ "summary": "Daily" }));
    stack
        .gmail()
        .change_event(ada.email(), PRIMARY, id, rename)?;
    calendar.wait_for_event("Daily").await?;
    calendar.wait_until_gone("Standup").await?;
    calendar.wait_until_synced(ada.email()).await?;

    stack.gmail().delete_event(ada.email(), PRIMARY, id)?;
    calendar.wait_until_gone("Daily").await?;
    assert_eq!(titles(&calendar.occurrences().await?), ["Retro"]);

    stack.finish().await
}

/// An Outlook inbox shows the events its calendar already held, and events
/// added, renamed and deleted in Outlook afterwards follow with the next
/// poll. Fails when the Outlook calendar import or its delta rounds are
/// broken.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_events_arrive_on_import_and_by_poll() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_outlook_mailbox(&stack, &ada)?;
    let standup = events::hour_in_days(1);
    let id =
        stack
            .outlook()
            .add_event(ada.email(), DEFAULT, &events::outlook("Standup", standup))?;

    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Standup").await?;

    let retro = events::outlook("Retro", events::hour_in_days(2));
    stack.outlook().add_event(ada.email(), DEFAULT, &retro)?;
    calendar.poll_outlook_now(ada.email()).await?;
    calendar.wait_for_event("Retro").await?;

    stack
        .outlook()
        .update_event(ada.email(), &id, &events::outlook("Daily", standup))?;
    calendar.poll_outlook_now(ada.email()).await?;
    calendar.wait_for_event("Daily").await?;
    calendar.wait_until_gone("Standup").await?;

    stack.outlook().delete_event(ada.email(), &id)?;
    calendar.poll_outlook_now(ada.email()).await?;
    calendar.wait_until_gone("Daily").await?;
    assert_eq!(titles(&calendar.occurrences().await?), ["Retro"]);

    stack.finish().await
}

/// Google's working-location, focus-time and out-of-office entries keep
/// their type, and take none of the calendar's default reminders: only real
/// meetings, and entries with a reminder of their own, do. Fails when status
/// entries are imported as ordinary meetings, which makes the calendar
/// remind the user ten minutes before their own working location.
/// (cal-google-status-events)
#[tokio::test(flavor = "multi_thread")]
async fn google_status_events_keep_their_type_and_take_no_default_reminders() -> Result<(), Report>
{
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let day = events::hour_in_days(3);
    let date = |days: i64| (day + Duration::days(days)).date_naive().to_string();
    seed_google_calendars(
        &stack,
        &ada,
        json!([{
            "default_reminders": [{ "method": "popup", "minutes": 10 }],
            "events": [
                events::google("Meeting", day),
                events::google_with("Office", day, json!({
                    "eventType": "workingLocation",
                    "workingLocationProperties": { "type": "officeLocation", "officeLocation": {} },
                    "transparency": "transparent",
                    "start": { "date": date(0) },
                    "end": { "date": date(1) },
                })),
                events::google_with("Focus", day + Duration::hours(2), json!({
                    "eventType": "focusTime",
                })),
                events::google_with("Away", day + Duration::hours(4), json!({
                    "eventType": "outOfOffice",
                })),
                events::google_with("Focus with a reminder", day + Duration::hours(6), json!({
                    "eventType": "focusTime",
                    "reminders": { "useDefault": false, "overrides": [{ "method": "popup", "minutes": 5 }] },
                })),
            ],
        }]),
    )?;

    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let items = calendar
        .wait_for_occurrences("the five seeded events", |items| items.len() == 5)
        .await?;
    let mut types: Vec<(String, String)> = items
        .iter()
        .map(|item| {
            let event = &item["event"];
            let event_type = &event["sources"][0]["eventType"];
            (
                event["title"].as_str().unwrap_or_default().to_owned(),
                event_type.as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect();
    types.sort();
    let expected = [
        ("Away", "out_of_office"),
        ("Focus", "focus_time"),
        ("Focus with a reminder", "focus_time"),
        ("Meeting", "default"),
        ("Office", "working_location"),
    ]
    .map(|(title, event_type)| (title.to_owned(), event_type.to_owned()));
    assert_eq!(types, expected, "{items:?}");

    let mut reminders: Vec<(String, i32)> = sqlx::query_as(
        "SELECT event.title, firing.minutes_before \
         FROM calendar_event_reminder_firings firing \
         JOIN calendar_events event ON event.id = firing.event_id",
    )
    .fetch_all(stack.db())
    .await?;
    reminders.sort();
    assert_eq!(
        reminders,
        [
            ("Focus with a reminder".to_owned(), 5),
            ("Meeting".to_owned(), 10)
        ]
    );

    stack.finish().await
}

/// A Google event that starts and ends at the same instant is imported like
/// any other, next to the calendar's ordinary events. Fails when the sync
/// rejects a zero-length event: the calendar then never finishes syncing and
/// shows nothing at all. (cal-zero-length-event)
#[tokio::test(flavor = "multi_thread")]
async fn a_zero_length_google_event_is_imported() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let at = events::hour_in_days(2);
    seed_google_calendars(
        &stack,
        &ada,
        json!([{ "events": [
            events::google_with("Deadline", at, json!({ "end": { "dateTime": at.to_rfc3339() } })),
            events::google("Lunch", at + Duration::hours(2)),
        ] }]),
    )?;

    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    let deadline = calendar.wait_for_event("Deadline").await?;
    let time = &deadline["occurrence"]["time"];
    assert!(time["startsAt"].is_string(), "{deadline}");
    assert_eq!(time["startsAt"], time["endsAt"], "{deadline}");
    calendar.wait_for_event("Lunch").await?;

    stack.finish().await
}

/// An Outlook event that starts and ends at the same instant is imported
/// like any other. Fails when the reader skips it as unreadable, so a
/// deadline the user put in Outlook is missing from Macro.
/// (cal-zero-length-event)
#[tokio::test(flavor = "multi_thread")]
async fn a_zero_length_outlook_event_is_imported() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    add_outlook_mailbox(&stack, &ada)?;
    let at = events::hour_in_days(2);
    let deadline = events::outlook_with("Deadline", at, json!({ "end": events::graph_time(at) }));
    stack.outlook().add_event(ada.email(), DEFAULT, &deadline)?;
    let lunch = events::outlook("Lunch", at + Duration::hours(2));
    stack.outlook().add_event(ada.email(), DEFAULT, &lunch)?;

    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Lunch").await?;
    let deadline = calendar.wait_for_event("Deadline").await?;
    let time = &deadline["occurrence"]["time"];
    assert!(time["startsAt"].is_string(), "{deadline}");
    assert_eq!(time["startsAt"], time["endsAt"], "{deadline}");

    stack.finish().await
}

/// An all-day Google event whose start and end are the same date, as
/// imported events can be, shows as that one day, and the rest of its
/// calendar is imported with it. Fails when one such event makes its whole
/// calendar fail to sync, so every event on it is missing.
/// (cal-google-one-bad-calendar-wedges-account)
#[tokio::test(flavor = "multi_thread")]
async fn a_same_date_all_day_google_event_does_not_block_its_calendar() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let day = events::hour_in_days(4);
    let date = day.date_naive();
    seed_google_calendars(
        &stack,
        &ada,
        json!([
            { "events": [events::google("Standup", day)] },
            { "id": TEAM_CALENDAR, "summary": "Team", "events": [
                events::google_with("Offsite", day, json!({
                    "start": { "date": date.to_string() },
                    "end": { "date": date.to_string() },
                })),
                events::google("Planning", day + Duration::hours(3)),
            ] },
        ]),
    )?;

    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Standup").await?;
    calendar.wait_for_event("Planning").await?;
    let offsite = calendar.wait_for_event("Offsite").await?;
    assert_eq!(
        offsite["occurrence"]["time"],
        json!({
            "kind": "allDay",
            "startDate": date.to_string(),
            "endDate": (date + Duration::days(1)).to_string(),
        }),
        "{offsite}"
    );

    stack.finish().await
}

/// A calendar Google refuses to watch (public holidays are one) is asked
/// once, not on every sync. Fails when each sync round asks again: every
/// round then costs a refused request per such calendar, for every user.
/// (cal-watch-refused-retried)
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_google_watch_is_not_retried_on_every_sync() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let day = events::hour_in_days(5);
    seed_google_calendars(
        &stack,
        &ada,
        json!([
            {},
            { "id": HOLIDAYS, "summary": "Holidays", "push_supported": false,
              "events": [events::google("Holiday", day)] },
        ]),
    )?;

    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Holiday").await?;

    // Each event added to the primary calendar is pushed and starts a sync
    // round of the whole account.
    for round in 1..=3 {
        let title = format!("Round {round}");
        let event = events::google(&title, day + Duration::hours(round));
        stack.gmail().add_event(ada.email(), PRIMARY, event)?;
        calendar.wait_for_event(&title).await?;
        calendar.wait_until_synced(ada.email()).await?;
    }

    let holidays = urlencoding::encode(HOLIDAYS).into_owned();
    let refused: Vec<_> = stack
        .gmail()
        .requests()
        .into_iter()
        .filter(|request| {
            request.route == Some(Route::EventsWatch)
                && (request.path.contains(HOLIDAYS) || request.path.contains(&holidays))
        })
        .collect();
    assert_eq!(refused.len(), 1, "{refused:?}");

    stack.finish().await
}

/// When Google answers a calendar sync with 429 and `Retry-After`, the
/// service leaves that account's calendars alone for that long, whatever
/// pushes arrive meanwhile, and catches up afterwards. Fails while the
/// service ignores the header and asks again as soon as its queue hands the
/// sync back, sooner than Google asked, which is how an account keeps
/// itself rate limited.
/// (cal-google-retry-after-ignored)
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: cal-google-retry-after-ignored"]
async fn google_retry_after_is_honoured_by_calendar_sync() -> Result<(), Report> {
    // Longer than the minute after which the queue redelivers a failed sync.
    const RETRY_AFTER_SECONDS: u32 = 90;

    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    seed_google_calendars(&stack, &ada, json!([]))?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;

    stack.gmail().inject_fault(Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(Route::EventsList),
        error: Some(FaultError::RateLimit),
        retry_after_seconds: Some(u64::from(RETRY_AFTER_SECONDS)),
        times: Some(1),
        ..Fault::default()
    });
    let day = events::hour_in_days(1);
    stack
        .gmail()
        .add_event(ada.email(), PRIMARY, events::google("First", day))?;
    let is_list = |request: &RequestRecord| {
        request.route == Some(Route::EventsList) && request.mailbox.as_deref() == Some(ada.email())
    };
    let limited_at = eventually(
        "Google to rate limit the sync",
        DEFAULT_TIMEOUT,
        async || {
            let requests = stack.gmail().requests();
            let limited = requests
                .iter()
                .find(|request| is_list(request) && request.status == 429);
            Ok(limited.map(|request| request.at))
        },
    )
    .await?;

    let second = events::google("Second", day + Duration::hours(2));
    stack.gmail().add_event(ada.email(), PRIMARY, second)?;
    calendar.wait_for_event("First").await?;
    calendar.wait_for_event("Second").await?;

    let wait = Duration::seconds(i64::from(RETRY_AFTER_SECONDS));
    let too_early: Vec<_> = stack
        .gmail()
        .requests()
        .into_iter()
        .filter(|request| {
            is_list(request) && request.at > limited_at && request.at < limited_at + wait
        })
        .collect();
    assert!(
        too_early.is_empty(),
        "the sync asked Google again before Retry-After had passed: {too_early:?}"
    );

    stack.finish().await
}

/// The service answers its clients and Google's pushes under `/calendar`,
/// the only prefix the gateway forwards to it: listing calendars and
/// creating an event work there, and a change at Google reaches the calendar
/// through a push delivered to `/calendar/notifications`. Fails when the
/// service is only reachable at its root, which in production means every
/// calendar request and every push is a 404. (cal-unreachable-behind-gateway)
#[tokio::test(flavor = "multi_thread")]
async fn the_calendar_service_answers_behind_the_gateway_prefix() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    seed_google_calendars(&stack, &ada, json!([]))?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;

    let listed = calendar.get("/calendars").await?.ok()?;
    let calendars = listed["calendars"].as_array().cloned().unwrap_or_default();
    assert_eq!(calendars.len(), 1, "{listed}");
    assert_eq!(calendars[0]["isPrimary"], true, "{listed}");

    let start = events::hour_in_days(1);
    let pushed = stack.google_calendar_pushes(ada.email());
    let created = calendar
        .post(
            "/events",
            &json!({
                "title": "Planning",
                "time": {
                    "kind": "timed",
                    "startsAt": start.to_rfc3339(),
                    "endsAt": (start + Duration::hours(1)).to_rfc3339(),
                    "timeZone": "UTC",
                },
            }),
        )
        .await?;
    assert!((200..300).contains(&created.status), "{}", created.text);
    stack
        .wait_for_google_calendar_push(ada.email(), pushed)
        .await?;
    calendar.wait_until_synced(ada.email()).await?;
    let at_google = stack.gmail().events(ada.email(), PRIMARY)?;
    let planning = at_google
        .iter()
        .find(|event| event["summary"] == "Planning");
    let id = planning.and_then(|event| event["id"].as_str());
    let id = id.unwrap_or_else(|| panic!("Google holds no Planning event: {at_google:?}"));

    let rename = NewEvent::from_json(json!({ "summary": "Renamed at Google" }));
    stack
        .gmail()
        .change_event(ada.email(), PRIMARY, id, rename)?;
    calendar.wait_for_event("Renamed at Google").await?;

    let deliveries = stack.gmail().channel_deliveries();
    assert!(!deliveries.is_empty(), "Google pushed nothing");
    for delivery in &deliveries {
        assert!(
            delivery.address.ends_with("/calendar/notifications"),
            "{delivery:?}"
        );
        assert_eq!(delivery.status, Some(200), "{delivery:?}");
    }

    stack.finish().await
}

/// A change at Google that arrives while a sync round is running is picked
/// up when that round ends. Fails while a push that finds a round under way
/// is dropped: the second of two quick changes at Google stays missing until
/// something else changes on that calendar.
/// (cal-google-push-during-sync-dropped)
#[tokio::test(flavor = "multi_thread")]
#[ignore = "known bug: cal-google-push-during-sync-dropped"]
async fn a_google_change_during_a_sync_round_is_not_lost() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    seed_google_calendars(&stack, &ada, json!([]))?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_until_synced(ada.email()).await?;

    // The round the first change starts reads the calendar, then waits on
    // Google's answer for a few seconds.
    stack.gmail().inject_fault(Fault {
        mailbox: Some(ada.email().to_owned()),
        route: Some(Route::EventsList),
        delay_ms: Some(4000),
        times: Some(1),
        ..Fault::default()
    });
    let day = events::hour_in_days(2);
    stack
        .gmail()
        .add_event(ada.email(), PRIMARY, events::google("First", day))?;
    eventually(
        "the sync round to read the calendar",
        DEFAULT_TIMEOUT,
        async || Ok(stack.gmail().faults().is_empty().then_some(())),
    )
    .await?;
    stack.gmail().add_event(
        ada.email(),
        PRIMARY,
        events::google("Second", day + Duration::hours(2)),
    )?;

    calendar.wait_for_event("First").await?;
    calendar.wait_for_event("Second").await?;

    stack.finish().await
}

/// One Google calendar that cannot be read does not stop the account's
/// other calendars from syncing, and it catches up once Google can read it
/// again. Fails when a failure of one calendar aborts the whole round: a
/// broken shared calendar then freezes the user's own.
/// (cal-google-one-bad-calendar-wedges-account)
#[tokio::test(flavor = "multi_thread")]
async fn one_unreadable_google_calendar_does_not_stop_the_others() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    let day = events::hour_in_days(4);
    seed_google_calendars(
        &stack,
        &ada,
        json!([
            { "events": [events::google("Standup", day)] },
            { "id": TEAM_CALENDAR, "summary": "Team", "events": [events::google("Planning", day)] },
        ]),
    )?;
    ada.link_gmail_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Planning").await?;
    calendar.wait_until_synced(ada.email()).await?;

    stack.gmail().fail_calendar(
        ada.email(),
        TEAM_CALENDAR,
        Some(FaultError::PreconditionFailed),
    )?;
    stack.gmail().add_event(
        ada.email(),
        PRIMARY,
        events::google("Review", day + Duration::hours(2)),
    )?;
    calendar.wait_for_event("Review").await?;
    calendar.wait_until_synced(ada.email()).await?;

    stack
        .gmail()
        .fail_calendar(ada.email(), TEAM_CALENDAR, None)?;
    stack.gmail().add_event(
        ada.email(),
        TEAM_CALENDAR,
        events::google("Retro", day + Duration::hours(4)),
    )?;
    calendar.wait_for_event("Retro").await?;

    stack.finish().await
}
