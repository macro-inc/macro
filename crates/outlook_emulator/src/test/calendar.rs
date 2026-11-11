//! The real Outlook calendar adapter against the emulator's calendars.

mod control;
mod faults;
mod guests;
mod sync;
mod write;

use calendar_events::domain::models::{
    CalendarEventDraft, CalendarEventPatch, CalendarEventUpsert, CalendarGrantBinding,
    CalendarProvider, EventTime, OccurrenceRange, ProviderCalendarTarget,
};
use calendar_events::domain::outlook::{OutlookCalendarReader, OutlookEventRefresh};
use chrono::{DateTime, TimeZone, Utc};
use email_api_client::OutlookApiClientRepository;
use serde_json::Value;
use uuid::Uuid;

use super::ADA;
use crate::{NewEvent, OutlookEmulator};

/// A seed whose default calendar holds a meeting, a weekly series with a
/// moved and a deleted occurrence, and an all-day event.
const SEED: &str = r##"
mailboxes:
  - email: ada@example.com
    name: Ada Example
    time_zone: Pacific Standard Time
    calendars:
      - name: Calendar
        default: true
        events:
          - subject: Design review
            start: { dateTime: "2026-11-12T10:00:00", timeZone: America/Los_Angeles }
            end: { dateTime: "2026-11-12T11:00:00", timeZone: America/Los_Angeles }
            location: { displayName: Room 4 }
            body: { contentType: html, content: "<p>Bring the mocks.</p>" }
          - subject: Weekly sync
            start: { dateTime: "2026-11-02T09:00:00", timeZone: America/Los_Angeles }
            end: { dateTime: "2026-11-02T09:30:00", timeZone: America/Los_Angeles }
            originalStartTimeZone: Pacific Standard Time
            recurrence:
              pattern: { type: weekly, interval: 1, daysOfWeek: [monday], firstDayOfWeek: sunday }
              range: { type: numbered, startDate: "2026-11-02", numberOfOccurrences: 5 }
            exceptions:
              - date: "2026-11-16"
                subject: Weekly sync (moved)
                start: { dateTime: "2026-11-17T14:00:00", timeZone: America/Los_Angeles }
                end: { dateTime: "2026-11-17T14:30:00", timeZone: America/Los_Angeles }
            cancelledOccurrences: ["2026-11-23"]
          - subject: Offsite
            isAllDay: true
            start: { dateTime: "2026-11-20T00:00:00", timeZone: UTC }
            end: { dateTime: "2026-11-21T00:00:00", timeZone: UTC }
      - name: Birthdays
        color: lightPink
        hex_color: "#e3008c"
        read_only: true
        online_meeting_providers: []
        events:
          - subject: Grace's birthday
            isAllDay: true
            start: { dateTime: "2026-12-09T00:00:00", timeZone: UTC }
            end: { dateTime: "2026-12-10T00:00:00", timeZone: UTC }
            recurrence:
              pattern: { type: absoluteYearly, interval: 1, dayOfMonth: 9, month: 12 }
              range: { type: noEnd, startDate: "2026-12-09" }
"##;

fn at(text: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(text)
        .unwrap()
        .with_timezone(&Utc)
}

fn binding() -> CalendarGrantBinding {
    CalendarGrantBinding {
        link_id: Uuid::from_u128(0xa11c),
        sync_generation: 1,
        grant_generation: 1,
    }
}

/// The sync target of one of a mailbox's calendars, for the year 2026.
fn target(emulator: &OutlookEmulator, email: &str, calendar: &str) -> ProviderCalendarTarget {
    let calendars = emulator.calendars(email).unwrap();
    let calendar = calendars
        .iter()
        .find(|known| known.name == calendar)
        .unwrap();
    ProviderCalendarTarget {
        binding: Some(binding()),
        provider: CalendarProvider::Outlook,
        owner_id: format!("macro|{email}"),
        email_link_id: binding().link_id,
        account_id: Uuid::from_u128(1),
        calendar_id: Uuid::from_u128(2),
        provider_calendar_id: calendar.id.clone(),
        observed_access_role: Some("writer".into()),
        is_read_only: !calendar.can_edit,
        range: OccurrenceRange {
            starts_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap(),
            start_date: "2026-01-01".parse().unwrap(),
            end_date: "2027-01-01".parse().unwrap(),
        },
    }
}

/// What the emulator holds for the event with a subject.
fn stored(emulator: &OutlookEmulator, email: &str, calendar: &str, subject: &str) -> Value {
    let events = emulator.events(email, calendar).unwrap();
    events
        .into_iter()
        .find(|event| event["subject"] == subject)
        .unwrap()
}

fn stored_id(emulator: &OutlookEmulator, email: &str, subject: &str) -> String {
    stored(emulator, email, "default", subject)["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// One delta round of the primary calendar, read to its delta link: every
/// member and tombstone, and the link.
async fn round(
    api: &OutlookApiClientRepository,
    token: &str,
    target: &ProviderCalendarTarget,
    cursor: Option<String>,
) -> (Vec<(String, String)>, Vec<String>, String) {
    let (mut members, mut removed) = (Vec::new(), Vec::new());
    let mut cursor = cursor;
    loop {
        let page = api
            .calendar_page(token, target, true, cursor.as_deref())
            .await
            .unwrap();
        members.extend(page.members);
        removed.extend(page.removed);
        match (page.next, page.delta) {
            (Some(next), _) => cursor = Some(next),
            (None, Some(delta)) => return (members, removed, delta),
            (None, None) => panic!("a primary calendar round ends with a delta link"),
        }
    }
}

/// An event read back the way the sync reads it.
async fn refreshed(
    api: &OutlookApiClientRepository,
    token: &str,
    target: &ProviderCalendarTarget,
    id: &str,
) -> CalendarEventUpsert {
    match api.refresh_calendar_event(token, target, id).await.unwrap() {
        OutlookEventRefresh::Refreshed { upsert, skipped } => {
            assert_eq!(skipped, vec![]);
            *upsert
        }
        OutlookEventRefresh::Gone => panic!("the event is gone"),
        OutlookEventRefresh::Unreadable { field } => panic!("unreadable at {field}"),
    }
}

fn timed(start: &str, end: &str, zone: &str) -> EventTime {
    EventTime::Timed {
        starts_at: at(start),
        ends_at: at(end),
        time_zone: Some(zone.into()),
    }
}

fn draft(title: &str, time: EventTime) -> CalendarEventDraft {
    CalendarEventDraft {
        idempotency_key: None,
        title: title.into(),
        description: None,
        location: None,
        time,
        attendees: vec![],
        recurrence_lines: vec![],
        visibility: None,
        transparency: None,
        reminders: None,
        conference: None,
        out_of_office: None,
        guest_policy: None,
    }
}

fn retitle(title: &str) -> CalendarEventPatch {
    CalendarEventPatch {
        title: Some(title.into()),
        ..CalendarEventPatch::default()
    }
}

fn new_event(json: Value) -> NewEvent {
    serde_json::from_value(json).unwrap()
}

fn access_token(emulator: &OutlookEmulator) -> String {
    emulator.access_token(ADA).unwrap()
}
