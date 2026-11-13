//! The real Google Calendar adapter of `calendar_events` running against the
//! emulator.

mod faults;
mod guests;
mod push;
mod sync;
mod write;

use calendar_events::domain::models::{
    CalendarEventDraft, CalendarEventUpsert, CalendarProvider, EventTime, GoogleSyncPlan,
    OccurrenceRange, ProviderCalendarTarget,
};
use calendar_events::domain::ports::GoogleEventSyncContext;
use calendar_events::outbound::google::GoogleCalendarClient;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{ADA, BOB};
use crate::{GmailEmulator, NewEvent, Seed, SeedCalendar, SeedMailbox};

const CAROL: &str = "carol@example.com";
const GRACE: &str = "grace@example.com";
const NEW_YORK: &str = "America/New_York";

/// The production Google Calendar adapter, pointed at the emulator.
fn calendar_client(emulator: &GmailEmulator) -> GoogleCalendarClient {
    GoogleCalendarClient::new_with_url(reqwest::Client::new(), emulator.calendar_url())
}

fn instant(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().to_utc()
}

/// One calendar as our sync and mutations address it, materializing
/// November 2026.
fn target(provider_calendar_id: &str) -> ProviderCalendarTarget {
    let starts_at = instant("2026-11-01T00:00:00Z");
    let ends_at = instant("2026-12-01T00:00:00Z");
    ProviderCalendarTarget {
        binding: None,
        provider: CalendarProvider::Google,
        owner_id: "macro|ada@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: provider_calendar_id.to_string(),
        observed_access_role: Some("owner".to_string()),
        is_read_only: false,
        range: OccurrenceRange {
            starts_at,
            ends_at,
            start_date: starts_at.date_naive(),
            end_date: ends_at.date_naive(),
        },
    }
}

/// A first sync: no token, the whole window.
fn first_sync(target: &ProviderCalendarTarget) -> GoogleEventSyncContext {
    GoogleEventSyncContext {
        target: target.clone(),
        sync_token: None,
        plan: GoogleSyncPlan::FullSnapshot,
    }
}

/// A later sync, from the token the last one returned.
fn next_sync(target: &ProviderCalendarTarget, sync_token: &str) -> GoogleEventSyncContext {
    GoogleEventSyncContext {
        target: target.clone(),
        sync_token: Some(sync_token.to_string()),
        plan: GoogleSyncPlan::Incremental,
    }
}

fn timed(starts_at: &str, ends_at: &str) -> EventTime {
    EventTime::Timed {
        starts_at: instant(starts_at),
        ends_at: instant(ends_at),
        time_zone: None,
    }
}

fn draft(title: &str, time: EventTime) -> CalendarEventDraft {
    CalendarEventDraft {
        idempotency_key: None,
        title: title.to_string(),
        description: None,
        location: None,
        time,
        attendees: Vec::new(),
        recurrence_lines: Vec::new(),
        visibility: None,
        transparency: None,
        reminders: None,
        conference: None,
        out_of_office: None,
        guest_policy: None,
    }
}

/// An hour-long event on a November 2026 day, in UTC.
fn event_on(id: &str, summary: &str, day: u8, hour: u8) -> NewEvent {
    NewEvent::from_json(json!({
        "id": id,
        "summary": summary,
        "start": { "dateTime": format!("2026-11-{day:02}T{hour:02}:00:00Z") },
        "end": { "dateTime": format!("2026-11-{day:02}T{:02}:00:00Z", hour + 1) },
    }))
}

fn mailbox_with_events(email: &str, events: Vec<NewEvent>) -> SeedMailbox {
    SeedMailbox {
        calendars: vec![SeedCalendar {
            events,
            ..SeedCalendar::default()
        }],
        ..SeedMailbox::new(email)
    }
}

async fn emulator_with(mailboxes: Vec<SeedMailbox>) -> GmailEmulator {
    GmailEmulator::start(Seed {
        mailboxes,
        ..Seed::default()
    })
    .await
    .unwrap()
}

fn upsert<'a>(upserts: &'a [CalendarEventUpsert], title: &str) -> &'a CalendarEventUpsert {
    upserts
        .iter()
        .find(|upsert| upsert.event.title == title)
        .unwrap_or_else(|| panic!("no event titled {title}"))
}

fn occurrence_keys(upsert: &CalendarEventUpsert) -> Vec<&str> {
    upsert
        .occurrences
        .iter()
        .map(|occurrence| occurrence.occurrence_key.as_str())
        .collect()
}

/// A stored event of the emulator, by its id.
fn stored(emulator: &GmailEmulator, email: &str, event_id: &str) -> Value {
    emulator
        .events(email, "primary")
        .unwrap()
        .into_iter()
        .find(|event| event["id"] == event_id)
        .unwrap_or_else(|| panic!("{email} holds no event {event_id}"))
}

/// A request to the Calendar API as a user, for what the adapter only sends
/// behind inputs this crate cannot build.
async fn api(
    emulator: &GmailEmulator,
    email: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> (u16, Value) {
    let token = emulator.access_token(email).unwrap();
    let url = format!("{}{path}", emulator.calendar_url());
    let mut request = reqwest::Client::new()
        .request(method, url)
        .bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.unwrap();
    let status = response.status().as_u16();
    let body = response.json().await.unwrap_or(Value::Null);
    (status, body)
}
