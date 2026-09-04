//! Wire-contract tests: the client's bodies and queries must deserialize
//! into the mutation router's request DTOs, and the router's error bodies
//! must map back to the domain failures they encode.

use chrono::{TimeZone, Utc};
use reqwest::StatusCode;
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    CalendarAttendeeInput, EventReminders, EventTime, OutOfOfficeAutoDeclineMode,
    OutOfOfficeProperties,
};
use crate::inbound::mutation_router::{
    CalendarMutationApiError, CalendarUpdateScopeParam, CreateCalendarEventRequest,
    DeleteCalendarEventQuery, RsvpCalendarEventRequest, UpdateCalendarEventRequest,
};

fn sample_draft() -> CalendarEventDraft {
    CalendarEventDraft {
        title: "Standup".to_string(),
        description: Some("Daily".to_string()),
        location: None,
        time: EventTime::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 8, 20, 17, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 8, 20, 18, 0, 0).unwrap(),
            time_zone: Some("America/New_York".to_string()),
        },
        attendees: vec![CalendarAttendeeInput {
            email: "guest@example.com".to_string(),
            is_optional: true,
            response_status: None,
        }],
        recurrence_lines: vec!["RRULE:FREQ=WEEKLY".to_string()],
        visibility: None,
        transparency: None,
        reminders: Some(EventReminders::default()),
        conference: Some(crate::domain::models::ConferenceChange::GoogleMeet),
        out_of_office: None,
    }
}

#[test]
fn create_body_matches_the_router_request() {
    let calendar_id = Some(Uuid::from_u128(3));
    let body = create_body(None, calendar_id, &sample_draft());
    let request: CreateCalendarEventRequest = serde_json::from_value(body).unwrap();

    assert_eq!(request.calendar_id, calendar_id);
    assert_eq!(request.email_link_id, None);
    assert_eq!(request.title, "Standup");
    assert_eq!(request.description.as_deref(), Some("Daily"));
    assert!(matches!(request.time, EventTime::Timed { .. }));
    assert_eq!(request.attendees.len(), 1);
    assert!(request.attendees[0].is_optional);
    assert_eq!(request.recurrence_lines, vec!["RRULE:FREQ=WEEKLY"]);
    assert_eq!(request.reminders, Some(EventReminders::default()));
    assert_eq!(
        request.conference,
        Some(crate::domain::models::ConferenceChange::GoogleMeet)
    );
}

#[test]
fn out_of_office_survives_the_create_wire_contract() {
    let mut draft = sample_draft();
    draft.attendees.clear();
    draft.out_of_office = Some(OutOfOfficeProperties {
        auto_decline_mode: OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations,
        decline_message: Some("Away".to_string()),
    });
    let request: CreateCalendarEventRequest =
        serde_json::from_value(create_body(None, None, &draft)).unwrap();

    let out_of_office = request
        .out_of_office
        .expect("out-of-office survives the wire");
    assert_eq!(
        out_of_office.auto_decline_mode,
        OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations
    );
    assert_eq!(out_of_office.decline_message.as_deref(), Some("Away"));
}

#[test]
fn out_of_office_survives_the_update_wire_contract() {
    let patch = CalendarEventPatch {
        out_of_office: Some(OutOfOfficeProperties {
            auto_decline_mode: OutOfOfficeAutoDeclineMode::DeclineOnlyNewConflictingInvitations,
            decline_message: None,
        }),
        ..Default::default()
    };
    let request: UpdateCalendarEventRequest =
        serde_json::from_value(update_body(&patch, &CalendarUpdateScope::All)).unwrap();

    assert_eq!(
        request
            .out_of_office
            .map(|properties| properties.auto_decline_mode),
        Some(OutOfOfficeAutoDeclineMode::DeclineOnlyNewConflictingInvitations)
    );
}

#[test]
fn update_body_matches_the_router_request() {
    let patch = CalendarEventPatch {
        title: Some("Renamed".to_string()),
        description: Some(String::new()),
        attendees: Some(vec![CalendarAttendeeInput {
            email: "guest@example.com".to_string(),
            is_optional: false,
            response_status: None,
        }]),
        conference: Some(crate::domain::models::ConferenceChange::Removed),
        ..Default::default()
    };
    let request: UpdateCalendarEventRequest =
        serde_json::from_value(update_body(&patch, &CalendarUpdateScope::All)).unwrap();

    assert_eq!(request.title.as_deref(), Some("Renamed"));
    assert_eq!(request.description.as_deref(), Some(""));
    assert_eq!(request.location, None);
    assert!(request.time.is_none());
    assert_eq!(request.attendees.map(|attendees| attendees.len()), Some(1));
    assert!(request.recurrence_lines.is_none());
    assert_eq!(
        request.conference,
        Some(crate::domain::models::ConferenceChange::Removed)
    );
    assert!(matches!(request.scope, Some(CalendarUpdateScopeParam::All)));
    assert!(request.recurrence_id.is_none());
}

/// An occurrence-scoped update must arrive at the router still scoped — a
/// body the router reads as scope-less would widen the write to the series.
#[test]
fn update_body_carries_the_occurrence_scope() {
    let patch = CalendarEventPatch {
        title: Some("Renamed".to_string()),
        ..Default::default()
    };
    let request: UpdateCalendarEventRequest = serde_json::from_value(update_body(
        &patch,
        &CalendarUpdateScope::ThisEvent {
            recurrence_id: "2026-08-18T20:00:00+00:00".to_string(),
        },
    ))
    .unwrap();

    assert_eq!(
        request.recurrence_id.as_deref(),
        Some("2026-08-18T20:00:00+00:00")
    );
    assert!(matches!(
        request.scope,
        Some(CalendarUpdateScopeParam::ThisEvent)
    ));
}

#[test]
fn delete_query_matches_the_router_query() {
    for (scope, expected_recurrence) in [
        (CalendarDeletionScope::All, None),
        (
            CalendarDeletionScope::ThisEvent {
                recurrence_id: "k-1".to_string(),
            },
            Some("k-1"),
        ),
        (
            CalendarDeletionScope::ThisAndFollowing {
                recurrence_id: "k-2".to_string(),
            },
            Some("k-2"),
        ),
    ] {
        let pairs = delete_query(&scope);
        let map: serde_json::Map<String, serde_json::Value> = pairs
            .into_iter()
            .map(|(key, value)| (key.to_string(), serde_json::Value::String(value)))
            .collect();
        let query: DeleteCalendarEventQuery =
            serde_json::from_value(serde_json::Value::Object(map)).unwrap();
        assert_eq!(query.recurrence_id.as_deref(), expected_recurrence);
    }
}

#[test]
fn rsvp_body_matches_the_router_request() {
    let body = rsvp_body(
        AttendeeResponseStatus::Accepted,
        &CalendarRsvpScope::ThisEvent {
            recurrence_id: "k-1".to_string(),
        },
    );
    let request: RsvpCalendarEventRequest = serde_json::from_value(body).unwrap();
    assert_eq!(request.response, AttendeeResponseStatus::Accepted);
    assert_eq!(request.recurrence_id.as_deref(), Some("k-1"));
}

#[test]
fn router_error_bodies_round_trip_to_their_domain_failures() {
    let cases = [
        CalendarMutationError::NotFound,
        CalendarMutationError::OccurrenceNotFound,
        CalendarMutationError::ReadOnly,
        CalendarMutationError::NoWritableCalendar,
        CalendarMutationError::NotAttendee,
        CalendarMutationError::InvalidInput("bad".to_string()),
        CalendarMutationError::ReauthRequired("expired".to_string()),
        CalendarMutationError::ProviderRejected("no".to_string()),
        CalendarMutationError::Retryable("later".to_string()),
        CalendarMutationError::PersistFailed("lag".to_string()),
    ];
    for domain_error in cases {
        let expected = std::mem::discriminant(&domain_error);
        let api_error = CalendarMutationApiError::from(domain_error);
        let body = serde_json::to_string(&api_error).unwrap();
        let parsed = error_from_response(StatusCode::BAD_REQUEST, Some(body));
        assert_eq!(std::mem::discriminant(&parsed), expected);
    }
}

#[test]
fn unrecognized_failures_are_classified_by_status() {
    // Only genuinely transient statuses may invite a retry — a retried
    // create is not idempotent.
    let parsed = error_from_response(StatusCode::SERVICE_UNAVAILABLE, None);
    assert!(matches!(parsed, CalendarMutationError::Retryable(_)));
    let parsed = error_from_response(StatusCode::TOO_MANY_REQUESTS, None);
    assert!(matches!(parsed, CalendarMutationError::Retryable(_)));

    let parsed = error_from_response(StatusCode::NOT_FOUND, Some("not found".to_string()));
    assert!(matches!(parsed, CalendarMutationError::NotFound));
    let parsed = error_from_response(StatusCode::BAD_REQUEST, Some("nope".to_string()));
    assert!(matches!(parsed, CalendarMutationError::InvalidInput(_)));
    let parsed = error_from_response(
        StatusCode::FORBIDDEN,
        Some(r#"{"code":"mystery","message":"no"}"#.to_string()),
    );
    assert!(matches!(parsed, CalendarMutationError::InvalidInput(_)));
    let parsed = error_from_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        Some(r#"{"code":"mystery","message":"no"}"#.to_string()),
    );
    assert!(matches!(parsed, CalendarMutationError::Retryable(_)));
}
