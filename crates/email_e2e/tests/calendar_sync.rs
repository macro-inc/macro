//! Calendar sync: what is on a provider's calendar reaches the Macro
//! calendar, on first import and as it changes.

use email_e2e::chrono::{DateTime, Duration, Utc};
use email_e2e::gmail_emulator::NewEvent as GoogleEvent;
use email_e2e::outlook_emulator::NewEvent as OutlookEvent;
use email_e2e::{Report, Stack, StackOptions};
use serde_json::json;

/// Google's id for a user's own calendar.
const PRIMARY: &str = "primary";
/// The Outlook emulator's name for a mailbox's own calendar.
const DEFAULT: &str = "default";

async fn calendar_stack() -> Result<Stack, Report> {
    Stack::start_with(StackOptions {
        calendar: true,
        ..StackOptions::default()
    })
    .await
}

/// The start of the hour `days` days from now.
fn in_days(days: i64) -> DateTime<Utc> {
    let at = Utc::now() + Duration::days(days);
    DateTime::from_timestamp(at.timestamp() - at.timestamp() % 3600, 0).unwrap_or(at)
}

/// An hour-long Google event.
fn google_event(title: &str, start: DateTime<Utc>) -> GoogleEvent {
    GoogleEvent::from_json(json!({
        "summary": title,
        "start": { "dateTime": start.to_rfc3339() },
        "end": { "dateTime": (start + Duration::hours(1)).to_rfc3339() },
    }))
}

/// An hour-long Outlook event.
fn outlook_event(title: &str, start: DateTime<Utc>) -> Result<OutlookEvent, Report> {
    let graph_time = |at: DateTime<Utc>| {
        json!({ "dateTime": at.format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone": "UTC" })
    };
    Ok(serde_json::from_value(json!({
        "subject": title,
        "start": graph_time(start),
        "end": graph_time(start + Duration::hours(1)),
    }))?)
}

/// A Gmail inbox linked with calendar consent shows the events its Google
/// calendar already held, and an event added at Google afterwards arrives
/// through Google's push. Fails when the first import or the push path
/// (watch channel, webhook, incremental sync) is broken.
#[tokio::test(flavor = "multi_thread")]
async fn google_events_arrive_on_import_and_by_push() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    stack.gmail().add_mailbox(&email_e2e::gmail_emulator::SeedMailbox {
        email: ada.email().to_owned(),
        ..Default::default()
    })?;
    let standup = in_days(1);
    stack
        .gmail()
        .add_event(ada.email(), PRIMARY, google_event("Standup", standup))?;

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

    stack
        .gmail()
        .add_event(ada.email(), PRIMARY, google_event("Retro", in_days(2)))?;
    calendar.wait_for_event("Retro").await?;

    stack.finish().await
}

/// An Outlook inbox shows the events its calendar already held, and an
/// event added in Outlook afterwards arrives with the next poll. Fails when
/// the Outlook calendar import or its delta rounds are broken.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_events_arrive_on_import_and_by_poll() -> Result<(), Report> {
    let stack = calendar_stack().await?;
    let ada = stack.user("ada").await?;
    stack
        .outlook()
        .add_mailbox(&email_e2e::outlook_emulator::SeedMailbox {
            email: ada.email().to_owned(),
            ..Default::default()
        })?;
    stack.outlook().add_event(
        ada.email(),
        DEFAULT,
        &outlook_event("Standup", in_days(1))?,
    )?;

    ada.link_outlook_with_calendar().await?;
    let calendar = ada.calendar()?;
    calendar.wait_for_event("Standup").await?;

    stack.outlook().add_event(
        ada.email(),
        DEFAULT,
        &outlook_event("Retro", in_days(2))?,
    )?;
    calendar.poll_outlook_now(ada.email()).await?;
    calendar.wait_for_event("Retro").await?;

    stack.finish().await
}
