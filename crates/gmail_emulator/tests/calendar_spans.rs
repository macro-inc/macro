//! What the real Google Calendar adapter records in its spans and logs,
//! captured with an isolated subscriber. A test binary of its own: tests
//! running in parallel without the subscriber would register the adapter's
//! callsites as uninteresting and hide its spans from the capture.

use std::sync::{Arc, Mutex};

use calendar_events::domain::models::{
    CalendarEventDraft, CalendarProvider, EventTime, GoogleSyncPlan, GoogleWatchConfig,
    OccurrenceRange, ProviderCalendarTarget,
};
use calendar_events::domain::ports::{
    CalendarMutationProvider, GoogleCalendarProvider, GoogleEventSyncContext,
};
use calendar_events::outbound::google::GoogleCalendarClient;
use chrono::{DateTime, Utc};
use gmail_emulator::{GmailEmulator, NewEvent, Seed, SeedCalendar, SeedMailbox};
use serde_json::json;
use tracing::instrument::WithSubscriber;
use tracing_subscriber::fmt::format::FmtSpan;
use uuid::Uuid;

const ADA: &str = "ada@example.com";

#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Captured {
    type Writer = Self;
    fn make_writer(&'a self) -> Self {
        self.clone()
    }
}

fn instant(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().to_utc()
}

/// Ada's primary calendar, whose Google id is her address, as sync and
/// mutations address it.
fn primary_calendar() -> ProviderCalendarTarget {
    let starts_at = instant("2026-11-01T00:00:00Z");
    let ends_at = instant("2026-12-01T00:00:00Z");
    ProviderCalendarTarget {
        binding: None,
        provider: CalendarProvider::Google,
        owner_id: "macro|ada@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: ADA.to_string(),
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

fn planning() -> CalendarEventDraft {
    CalendarEventDraft {
        idempotency_key: None,
        title: "Planning".to_string(),
        description: None,
        location: None,
        time: EventTime::Timed {
            starts_at: instant("2026-11-10T15:00:00Z"),
            ends_at: instant("2026-11-10T16:00:00Z"),
            time_zone: None,
        },
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

/// A primary calendar's Google id is its owner's address, so the adapter's
/// spans and logs name the calendar by Macro's id. Fails while a sync, a
/// watch or a write records the provider id.
#[tokio::test]
async fn google_calendar_spans_name_a_primary_calendar_by_macros_id() {
    let emulator = GmailEmulator::start(Seed {
        mailboxes: vec![SeedMailbox {
            calendars: vec![SeedCalendar {
                events: vec![NewEvent::from_json(json!({
                    "id": "design1",
                    "summary": "Design review",
                    "start": { "dateTime": "2026-11-05T15:00:00Z" },
                    "end": { "dateTime": "2026-11-05T16:00:00Z" },
                }))],
                ..SeedCalendar::default()
            }],
            ..SeedMailbox::new(ADA)
        }],
        ..Seed::default()
    })
    .await
    .unwrap();
    let client =
        GoogleCalendarClient::new_with_url(reqwest::Client::new(), emulator.calendar_url());
    let token = emulator.access_token(ADA).unwrap();
    let target = primary_calendar();
    let captured = Captured::default();
    let subscriber = tracing_subscriber::fmt()
        .without_time()
        .with_ansi(false)
        .with_span_events(FmtSpan::CLOSE)
        .with_env_filter("calendar_events=trace")
        .with_writer(captured.clone())
        .finish();

    async {
        client
            .sync_events(
                &token,
                GoogleEventSyncContext {
                    target: target.clone(),
                    sync_token: None,
                    plan: GoogleSyncPlan::FullSnapshot,
                },
            )
            .await
            .unwrap();
        client
            .create_event(&token, &target, &planning())
            .await
            .unwrap();
        // No one listens at the address; the watch itself is what is traced.
        let config = GoogleWatchConfig {
            address: "http://127.0.0.1:9/calendar/watch/notifications".to_string(),
            token: "channel-token".to_string(),
        };
        client
            .watch_calendar(
                &token,
                target.email_link_id,
                target.calendar_id,
                &target.provider_calendar_id,
                Uuid::now_v7(),
                &config,
            )
            .await
            .unwrap();
        // A request that never reaches Google fails with the URL it was for.
        let unreachable =
            GoogleCalendarClient::new_with_url(reqwest::Client::new(), "http://127.0.0.1:9".into());
        unreachable
            .create_event(&token, &target, &planning())
            .await
            .unwrap_err();
    }
    .with_subscriber(subscriber)
    .await;

    let output = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
    for span in ["sync_events", "create_event", "watch_calendar"] {
        assert!(output.contains(span), "{span} was not traced:\n{output}");
    }
    assert!(
        output.contains(&format!("calendar_id={}", target.calendar_id)),
        "{output}"
    );
    // Google's shared calendars stay distinguishable without their ids.
    assert!(output.contains("system_calendar=false"), "{output}");
    assert!(
        output.contains("error"),
        "the failed request was not traced:\n{output}"
    );
    // The address as it appears in a request URL.
    let encoded = ADA.replace('@', "%40");
    assert!(
        !output.contains(ADA) && !output.contains(&encoded),
        "{output}"
    );
}
