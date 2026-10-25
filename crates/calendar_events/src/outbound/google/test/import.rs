use super::*;
use crate::domain::ics::{CalendarEventExport, CalendarEventExportAccess};

fn export(time: EventTime, recurrence_lines: Vec<String>) -> CalendarEventExport {
    CalendarEventExport {
        access: CalendarEventExportAccess::ChannelShared,
        owner_id: "macro|organizer@example.com".to_string(),
        event_type: EventType::Default,
        ical_uid: "meeting@example.com".to_string(),
        sequence: 4,
        title: "Offsite".to_string(),
        description: Some("<p>Agenda</p>".to_string()),
        location: Some("HQ".to_string()),
        time,
        recurrence_lines,
        organizer_email: Some("organizer@example.com".to_string()),
        organizer_name: Some("Organizer".to_string()),
        updated_at: Utc::now(),
    }
}

#[test]
fn import_body_lists_only_the_calendar_as_a_guest_and_marks_the_snapshot() {
    let source = export(
        EventTime::AllDay {
            start_date: NaiveDate::from_ymd_opt(2026, 9, 24).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 9, 25).unwrap(),
        },
        vec!["RRULE:FREQ=WEEKLY".to_string()],
    );

    let body = super::super::import::import_body(&source, "member@example.com");

    assert_eq!(body["iCalUID"], "meeting@example.com");
    assert_eq!(body["summary"], "Offsite");
    assert_eq!(body["description"], "<p>Agenda</p>");
    assert_eq!(body["location"], "HQ");
    assert_eq!(body["sequence"], 4);
    assert_eq!(body["start"]["date"], "2026-09-24");
    assert_eq!(body["end"]["date"], "2026-09-25");
    assert_eq!(body["recurrence"], serde_json::json!(["RRULE:FREQ=WEEKLY"]));
    assert_eq!(
        body["organizer"],
        serde_json::json!({ "email": "organizer@example.com", "displayName": "Organizer" })
    );
    // Google imports only for the organizer or an attendee, so the calendar
    // is the one guest, already answered; the meeting's guests stay out.
    assert_eq!(
        body["attendees"],
        serde_json::json!([{ "email": "member@example.com", "responseStatus": "accepted" }])
    );
    assert_eq!(
        body["extendedProperties"],
        serde_json::json!({ "private": { "macroSnapshot": "true" } })
    );
    assert!(body.get("conferenceData").is_none());
}

#[cfg(feature = "inbound")]
#[tokio::test]
async fn import_writes_only_when_the_calendar_does_not_hold_the_meeting() {
    use axum::{
        Json, Router,
        extract::{Query, State},
        routing::{get, post},
    };
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct Remote {
        held: Arc<Mutex<Vec<serde_json::Value>>>,
        imports: Arc<Mutex<Vec<serde_json::Value>>>,
        listed_uids: Arc<Mutex<Vec<String>>>,
    }
    async fn list(
        State(remote): State<Remote>,
        Query(query): Query<std::collections::HashMap<String, String>>,
    ) -> Json<serde_json::Value> {
        // Hidden invitations count: an import would overwrite them too.
        assert_eq!(
            query.get("showHiddenInvitations").map(String::as_str),
            Some("true")
        );
        remote
            .listed_uids
            .lock()
            .unwrap()
            .push(query.get("iCalUID").cloned().unwrap_or_default());
        let held = remote.held.lock().unwrap().clone();
        Json(serde_json::json!({ "items": held }))
    }
    // Google imports an event only into its organizer's or an attendee's
    // calendar, and answers anything else with this refusal.
    async fn import(
        State(remote): State<Remote>,
        Json(body): Json<serde_json::Value>,
    ) -> (axum::http::StatusCode, Json<serde_json::Value>) {
        remote.imports.lock().unwrap().push(body.clone());
        let organizes = body["organizer"]["email"] == "primary";
        let attends = body["attendees"]
            .as_array()
            .is_some_and(|attendees| attendees.iter().any(|guest| guest["email"] == "primary"));
        if !organizes && !attends {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": {
                        "code": 400,
                        "message": "The owner of the calendar must either be the organizer or an attendee of an event that is imported.",
                        "errors": [{ "reason": "participantIsNeitherOrganizerNorAttendee" }]
                    }
                })),
            );
        }
        let mut event = body;
        event["id"] = serde_json::json!("imported-id");
        event["created"] = serde_json::json!("2026-07-20T14:00:00Z");
        event["updated"] = serde_json::json!("2026-07-20T14:00:00Z");
        (axum::http::StatusCode::OK, Json(event))
    }
    let remote = Remote::default();
    let app = Router::new()
        .route("/calendars/primary/events", get(list))
        .route("/calendars/primary/events/import", post(import))
        .with_state(remote.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = GoogleCalendarClient {
        client: Client::new(),
        gate: UnmeteredGate,
        api_base: endpoint,
    };
    let target = ProviderCalendarTarget {
        binding: None,
        provider: crate::domain::models::CalendarProvider::Google,
        observed_access_role: Some("owner".to_owned()),
        owner_id: "macro|member@example.test".into(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".into(),
        is_read_only: false,
        range: OccurrenceRange::maintenance_horizon(Utc::now()),
    };
    let starts_at = Utc::now() + chrono::Duration::days(1);
    let source = export(
        EventTime::Timed {
            starts_at,
            ends_at: starts_at + chrono::Duration::hours(1),
            time_zone: Some("UTC".to_string()),
        },
        Vec::new(),
    );

    let ProviderImportOutcome::Imported(copied) = client
        .import_event("test-token", &target, &source)
        .await
        .unwrap()
    else {
        panic!("an empty calendar takes the snapshot");
    };
    assert_eq!(copied.event.ical_uid, "meeting@example.com");
    assert_eq!(copied.event.title, "Offsite");
    assert_eq!(
        copied.event.organizer_email.as_deref(),
        Some("organizer@example.com")
    );
    assert!(copied.event.is_snapshot);
    let guests: Vec<_> = copied
        .event
        .attendees
        .iter()
        .map(|guest| (guest.email.as_str(), guest.response_status))
        .collect();
    assert_eq!(
        guests,
        vec![(
            "primary",
            crate::domain::models::AttendeeResponseStatus::Accepted
        )]
    );
    assert_eq!(remote.imports.lock().unwrap().len(), 1);

    // An invitation Google holds but Macro has not synced yet would lose its
    // guests and join link if the import updated it in place.
    remote.held.lock().unwrap().push(serde_json::json!({
        "id": "invitation-id",
        "iCalUID": "meeting@example.com",
        "summary": "Offsite",
        "start": {"dateTime": "2026-07-24T14:00:00Z"},
        "end": {"dateTime": "2026-07-24T15:00:00Z"},
        "created": "2026-07-20T14:00:00Z",
        "updated": "2026-07-20T14:00:00Z"
    }));
    let held = client
        .import_event("test-token", &target, &source)
        .await
        .unwrap();
    assert!(matches!(held, ProviderImportOutcome::AlreadyHeld));
    assert_eq!(remote.imports.lock().unwrap().len(), 1);
    assert_eq!(
        *remote.listed_uids.lock().unwrap(),
        vec!["meeting@example.com", "meeting@example.com"]
    );
    task.abort();
}

#[cfg(feature = "inbound")]
#[tokio::test]
async fn import_reports_a_refusal_apart_from_a_failure_worth_retrying() {
    use axum::{
        Json, Router,
        extract::State,
        http::StatusCode,
        routing::{get, post},
    };
    use std::sync::{Arc, Mutex};

    let answer = Arc::new(Mutex::new((StatusCode::OK, serde_json::Value::Null)));
    let app = Router::new()
        .route(
            "/calendars/primary/events",
            get(|| async { Json(serde_json::json!({ "items": [] })) }),
        )
        .route(
            "/calendars/primary/events/import",
            post(
                |State(answer): State<Arc<Mutex<(StatusCode, serde_json::Value)>>>| async move {
                    let (status, body) = answer.lock().unwrap().clone();
                    (status, Json(body))
                },
            ),
        )
        .with_state(answer.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = GoogleCalendarClient {
        client: Client::new(),
        gate: UnmeteredGate,
        api_base: endpoint,
    };
    let target = ProviderCalendarTarget {
        binding: None,
        provider: crate::domain::models::CalendarProvider::Google,
        observed_access_role: Some("owner".to_owned()),
        owner_id: "macro|member@example.test".into(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".into(),
        is_read_only: false,
        range: OccurrenceRange::maintenance_horizon(Utc::now()),
    };
    let starts_at = Utc::now() + chrono::Duration::days(1);
    let source = export(
        EventTime::Timed {
            starts_at,
            ends_at: starts_at + chrono::Duration::hours(1),
            time_zone: Some("UTC".to_string()),
        },
        Vec::new(),
    );

    *answer.lock().unwrap() = (
        StatusCode::BAD_REQUEST,
        serde_json::json!({
            "error": {
                "code": 400,
                "message": "The owner of the calendar must either be the organizer or an attendee of an event that is imported.",
                "errors": [{ "reason": "participantIsNeitherOrganizerNorAttendee" }]
            }
        }),
    );
    let refused = client
        .import_event("test-token", &target, &source)
        .await
        .unwrap();
    let ProviderImportOutcome::Refused(error) = refused else {
        panic!("Google's refusal is reported as a refused import");
    };
    assert!(
        error
            .to_string()
            .contains("participantIsNeitherOrganizerNorAttendee")
    );

    *answer.lock().unwrap() = (
        StatusCode::FORBIDDEN,
        serde_json::json!({
            "error": {
                "code": 403,
                "message": "Rate Limit Exceeded",
                "errors": [{ "reason": "rateLimitExceeded" }]
            }
        }),
    );
    let Err(error) = client.import_event("test-token", &target, &source).await else {
        panic!("a rate limit is not a refusal");
    };
    assert_eq!(error.kind(), CalendarProviderErrorKind::Transient);
    task.abort();
}

/// Google's copy of the meeting on the member's calendar.
fn copy_on_calendar(attendees: serde_json::Value, marked: bool) -> GoogleEvent {
    let mut event = serde_json::json!({
        "id": "meeting-id",
        "iCalUID": "meeting@example.com",
        "status": "confirmed",
        "organizer": { "email": "organizer@example.com" },
        "attendees": attendees,
    });
    if marked {
        event["extendedProperties"] = serde_json::json!({ "private": { "macroSnapshot": "true" } });
    }
    serde_json::from_value(event).unwrap()
}

#[test]
fn an_invitation_reaching_a_snapshot_makes_it_the_owners_seat() {
    let is_snapshot =
        |event: &GoogleEvent| super::super::import::is_snapshot(event, "member@example.com");
    let calendar = |status: &str| serde_json::json!({ "email": "member@example.com", "self": true, "responseStatus": status });

    // What the import wrote, including the owner answering it in Google.
    assert!(is_snapshot(&copy_on_calendar(
        serde_json::json!([calendar("accepted")]),
        true
    )));
    assert!(is_snapshot(&copy_on_calendar(
        serde_json::json!([calendar("declined")]),
        true
    )));
    // The import's own echo names the calendar without Google's `self` flag.
    assert!(is_snapshot(&copy_on_calendar(
        serde_json::json!([{ "email": "Member@example.com", "responseStatus": "accepted" }]),
        true
    )));

    // A Google meeting lists its organizer beside the invited calendar.
    assert!(!is_snapshot(&copy_on_calendar(
        serde_json::json!([
            { "email": "organizer@example.com", "organizer": true, "responseStatus": "accepted" },
            calendar("needsAction"),
        ]),
        true
    )));
    // A meeting that lists only the invitee still asks them to answer.
    assert!(!is_snapshot(&copy_on_calendar(
        serde_json::json!([calendar("needsAction")]),
        true
    )));
    assert!(!is_snapshot(&copy_on_calendar(
        serde_json::json!([{ "email": "member@example.com", "self": true }]),
        true
    )));
    assert!(!is_snapshot(&copy_on_calendar(
        serde_json::json!([calendar("accepted")]),
        false
    )));
}
