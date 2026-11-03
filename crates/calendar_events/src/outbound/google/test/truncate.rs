#![cfg(feature = "inbound")]

use super::*;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode as AxumStatus,
    routing::get,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

/// An id Google gives a series split off another without moving it in time.
const SPLIT_SERIES: &str = "base_R20260921T140000";
/// The id Google moves that series to when its recurrence changes.
const REPLACEMENT: &str = "freshid";
const CUTOFF: &str = "2026-11-02T15:00:00+00:00";

fn series(id: &str, status: &str, sequence: u32, recurrence: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "iCalUID": format!("{id}@google.com"),
        "status": status,
        "eventType": "default",
        "summary": "Weekly sync",
        "sequence": sequence,
        "start": {"dateTime": "2026-09-21T10:00:00-04:00", "timeZone": "America/New_York"},
        "end": {"dateTime": "2026-09-21T11:00:00-04:00", "timeZone": "America/New_York"},
        "recurrence": [recurrence],
        "created": "2026-09-04T19:13:09.000Z",
        "updated": "2026-11-02T14:52:50.000Z"
    })
}

/// Google's calendar, holding each event by id, with what each patch sent.
#[derive(Clone, Default)]
struct Remote {
    events: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    patches: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
}

impl Remote {
    fn holding(events: Vec<serde_json::Value>) -> Self {
        let remote = Self::default();
        for event in events {
            remote
                .events
                .lock()
                .unwrap()
                .insert(event["id"].as_str().unwrap().to_string(), event);
        }
        remote
    }
}

async fn read(
    State(remote): State<Remote>,
    Path(id): Path<String>,
) -> (AxumStatus, Json<serde_json::Value>) {
    match remote.events.lock().unwrap().get(&id) {
        Some(event) => (AxumStatus::OK, Json(event.clone())),
        None => (AxumStatus::NOT_FOUND, Json(serde_json::json!({}))),
    }
}

/// As Google does: a change to a tombstone is refused, and a change to the
/// recurrence of a split series moves it to a new id and UID, leaving a
/// tombstone behind. Any other series takes the change in place.
async fn patch(
    State(remote): State<Remote>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> (AxumStatus, Json<serde_json::Value>) {
    remote
        .patches
        .lock()
        .unwrap()
        .push((id.clone(), body.clone()));
    let mut events = remote.events.lock().unwrap();
    let Some(event) = events.get_mut(&id) else {
        return (AxumStatus::NOT_FOUND, Json(serde_json::json!({})));
    };
    if event["status"] == "cancelled" {
        return (
            AxumStatus::BAD_REQUEST,
            Json(serde_json::json!({
                "error": {
                    "code": 400,
                    "message": "Bad Request",
                    "errors": [{ "reason": "badRequest" }]
                }
            })),
        );
    }
    event["recurrence"] = body["recurrence"].clone();
    if !id.contains("_R") {
        return (AxumStatus::OK, Json(event.clone()));
    }
    let recurrence = body["recurrence"][0].as_str().unwrap().to_string();
    event["status"] = serde_json::json!("cancelled");
    let replacement = series(REPLACEMENT, "confirmed", 1, &recurrence);
    events.insert(REPLACEMENT.to_string(), replacement.clone());
    (AxumStatus::OK, Json(replacement))
}

async fn list() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "items": [] }))
}

async fn serve(remote: Remote) -> (GoogleCalendarClient<UnmeteredGate>, ProviderCalendarTarget) {
    let app = Router::new()
        .route("/calendars/primary/events", get(list))
        .route("/calendars/primary/events/{id}", get(read).patch(patch))
        .route("/calendars/primary/events/{id}/instances", get(list))
        .with_state(remote);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = GoogleCalendarClient {
        client: Client::new(),
        gate: UnmeteredGate,
        api_base: endpoint,
    };
    let range_start = DateTime::parse_from_rfc3339("2026-09-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let target = ProviderCalendarTarget {
        binding: None,
        provider: crate::domain::models::CalendarProvider::Google,
        observed_access_role: Some("owner".to_owned()),
        owner_id: "macro|truncate@example.test".to_owned(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_owned(),
        is_read_only: false,
        range: OccurrenceRange {
            starts_at: range_start,
            ends_at: range_start + chrono::Duration::days(180),
            start_date: range_start.date_naive(),
            end_date: range_start.date_naive() + chrono::Duration::days(180),
        },
    };
    (client, target)
}

/// The prod sequence: the first truncation of a split series comes back as a
/// new event, and the same delete again reaches the tombstone it left.
#[tokio::test]
async fn a_replaced_series_echoes_its_new_id_and_a_repeat_finds_it_gone() {
    let remote = Remote::holding(vec![series(
        SPLIT_SERIES,
        "confirmed",
        0,
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
    )]);
    let (client, target) = serve(remote.clone()).await;

    let first = client
        .truncate_recurring_event("token", &target, SPLIT_SERIES, CUTOFF)
        .await
        .unwrap();
    let ProviderSeriesMutationOutcome::Applied(echo) = first else {
        panic!("the truncation should echo what is left of the series");
    };
    assert_eq!(echo.source.details().provider_event_id, REPLACEMENT);
    assert_eq!(echo.event.ical_uid, format!("{REPLACEMENT}@google.com"));
    assert_eq!(
        echo.event.recurrence_lines,
        ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261102T145959Z"]
    );

    let repeat = client
        .truncate_recurring_event("token", &target, SPLIT_SERIES, CUTOFF)
        .await
        .unwrap();
    assert!(matches!(repeat, ProviderSeriesMutationOutcome::Gone));
    assert_eq!(
        remote.patches.lock().unwrap().len(),
        1,
        "a tombstone is not patched: Google refuses it"
    );
}

#[tokio::test]
async fn a_plain_series_keeps_its_id_and_takes_a_repeat() {
    let remote = Remote::holding(vec![series(
        "plain",
        "confirmed",
        0,
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
    )]);
    let (client, target) = serve(remote.clone()).await;

    for _ in 0..2 {
        let outcome = client
            .truncate_recurring_event("token", &target, "plain", CUTOFF)
            .await
            .unwrap();
        let ProviderSeriesMutationOutcome::Applied(echo) = outcome else {
            panic!("a plain series survives truncation");
        };
        assert_eq!(echo.source.details().provider_event_id, "plain");
    }
    assert_eq!(remote.patches.lock().unwrap().len(), 2);
}
