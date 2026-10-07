use std::sync::{Arc, Mutex};

use async_graphql::{EmptySubscription, Schema};
use calendar_events::domain::{
    changes::{
        CalendarChangeQueryService, CalendarChangesPage, CalendarEventChange, CalendarWatermark,
        EventOccurrence,
    },
    models::{
        AttendeeResponseStatus, CalendarEvent, CalendarEventDraft, CalendarEventPatch,
        ConferenceChange, EventTime, EventVisibility, OutOfOfficeAutoDeclineMode, VisibleCalendar,
    },
    ports::{
        CalendarDeletionScope, CalendarMutationError, CalendarMutationService, CalendarRsvpScope,
        CalendarUpdateScope,
    },
};
use chrono::{NaiveDate, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;
use uuid::Uuid;

use super::CalendarMutationRoot;
use crate::{
    CalendarGraphqlMutationContext, GraphqlCalendarQuery,
    test_fixtures::{EVENT_ID, LINK_ID, series_event, timed_listing},
};

const VIEWER: &str = "macro|viewer@example.com";

#[derive(Debug, PartialEq)]
enum Call {
    Create(Option<Uuid>, Option<Uuid>, CalendarEventDraft),
    Update(Uuid, Option<Uuid>, CalendarEventPatch, CalendarUpdateScope),
    Delete(Uuid, Option<Uuid>, CalendarDeletionScope),
    Rsvp(
        Uuid,
        Option<Uuid>,
        AttendeeResponseStatus,
        CalendarRsvpScope,
        Option<String>,
    ),
}

#[derive(Default)]
struct FakeMutations {
    calls: Mutex<Vec<(String, Call)>>,
    failure: Mutex<Option<CalendarMutationError>>,
}

impl FakeMutations {
    fn record(&self, viewer: &str, call: Call) -> Result<(), CalendarMutationError> {
        self.calls.lock().unwrap().push((viewer.to_owned(), call));
        match self.failure.lock().unwrap().take() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl CalendarMutationService for FakeMutations {
    async fn create_event(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.record(
            requester_id,
            Call::Create(email_link_id, calendar_id, draft),
        )?;
        Ok(series_event())
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, CalendarMutationError> {
        unreachable!("calendars are read through the query fields")
    }

    async fn update_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.record(
            requester_id,
            Call::Update(event_id, calendar_id, patch, scope),
        )?;
        Ok(series_event())
    }

    async fn delete_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        scope: CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        self.record(requester_id, Call::Delete(event_id, calendar_id, scope))
    }

    async fn respond_to_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
        responding_email: Option<String>,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.record(
            requester_id,
            Call::Rsvp(event_id, calendar_id, response, scope, responding_email),
        )?;
        Ok(series_event())
    }

    async fn disconnect_calendar(
        &self,
        _requester_id: &str,
        _email_link_id: Uuid,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("disconnecting a calendar is not a GraphQL mutation")
    }
}

#[derive(Default)]
struct FakeCommitted {
    change: Option<CalendarEventChange>,
    fail: bool,
    reads: Mutex<Vec<(String, Uuid)>>,
}

impl CalendarChangeQueryService for FakeCommitted {
    async fn current_watermark(&self, _viewer: &str) -> Result<CalendarWatermark, Report> {
        unreachable!("mutations read no watermark")
    }

    async fn changes_since(
        &self,
        _viewer: &str,
        _since: CalendarWatermark,
    ) -> Result<CalendarChangesPage, Report> {
        unreachable!("mutations read no change pages")
    }

    async fn event_change(
        &self,
        viewer: &str,
        event_id: Uuid,
    ) -> Result<Option<CalendarEventChange>, Report> {
        self.reads
            .lock()
            .unwrap()
            .push((viewer.to_owned(), event_id));
        if self.fail {
            return Err(rootcause::report!("replica db-3 unreachable").into());
        }
        Ok(self.change.clone())
    }
}

fn committed_change() -> CalendarEventChange {
    let listing = timed_listing(6);
    CalendarEventChange {
        event: listing.event,
        link_id: LINK_ID,
        occurrences: vec![EventOccurrence {
            occurrence: listing.occurrence,
            exception: listing.exception,
        }],
    }
}

async fn execute(
    mutations: Arc<FakeMutations>,
    committed: Arc<FakeCommitted>,
    query: &str,
    authenticated: bool,
) -> async_graphql::Response {
    let schema = Schema::build(
        GraphqlCalendarQuery::new(MacroUserIdStr::parse_from_str(VIEWER).unwrap()),
        CalendarMutationRoot,
        EmptySubscription,
    )
    .data(CalendarGraphqlMutationContext::new(mutations, committed))
    .finish();
    let request = async_graphql::Request::new(query);
    let request = if authenticated {
        request.data(MacroUserIdStr::parse_from_str(VIEWER).unwrap())
    } else {
        request
    };
    schema.execute(request).await
}

fn error_extensions(response: &async_graphql::Response) -> (String, Value, Value) {
    let error = &response.errors[0];
    let extensions = error.extensions.as_ref().expect("extensions");
    (
        error.message.clone(),
        extensions.get("code").unwrap().clone().into_json().unwrap(),
        extensions
            .get("retryable")
            .map(|value| value.clone().into_json().unwrap())
            .unwrap_or(Value::Null),
    )
}

const PAYLOAD: &str =
    "event { id linkId title } occurrences { id eventId event { id } } deletedEventId";

#[tokio::test]
async fn create_maps_the_input_and_answers_with_the_committed_event() {
    let mutations = Arc::new(FakeMutations::default());
    let committed = Arc::new(FakeCommitted {
        change: Some(committed_change()),
        ..Default::default()
    });
    let calendar = Uuid::from_u128(0xca);
    let key = Uuid::from_u128(0x1d);

    let response = execute(
        Arc::clone(&mutations),
        Arc::clone(&committed),
        &format!(
            r#"mutation {{ createCalendarEvent(input: {{
                idempotencyKey: "{key}", calendarId: "{calendar}", title: "Lunch",
                time: {{ allDay: {{ startDate: "2026-10-06", endDate: "2026-10-07" }} }},
                attendees: [{{ email: "guest@example.com" }}],
                visibility: PRIVATE, conference: NONE,
                reminders: {{ useDefault: false, overrides: [{{ method: "popup", minutes: 10 }}] }},
                outOfOffice: {{ declineMessage: "away" }}
            }}) {{ {PAYLOAD} }} }}"#
        ),
        true,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let payload = &data["createCalendarEvent"];
    assert_eq!(payload["event"]["id"], EVENT_ID.to_string());
    assert_eq!(payload["event"]["linkId"], LINK_ID.to_string());
    assert_eq!(
        payload["occurrences"][0]["event"]["id"],
        EVENT_ID.to_string()
    );
    assert_eq!(payload["deletedEventId"], Value::Null);

    let calls = mutations.calls.lock().unwrap();
    let (viewer, Call::Create(email_link_id, calendar_id, draft)) = &calls[0] else {
        panic!("expected a create, got {calls:?}");
    };
    assert_eq!(viewer, VIEWER);
    assert_eq!(*email_link_id, None);
    assert_eq!(*calendar_id, Some(calendar));
    assert_eq!(draft.idempotency_key, Some(key));
    assert_eq!(
        draft.time,
        EventTime::AllDay {
            start_date: NaiveDate::from_ymd_opt(2026, 10, 6).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 10, 7).unwrap(),
        }
    );
    assert!(!draft.attendees[0].is_optional);
    assert_eq!(draft.attendees[0].response_status, None);
    assert_eq!(draft.visibility, Some(EventVisibility::Private));
    assert_eq!(draft.conference, Some(ConferenceChange::Removed));
    let reminders = draft.reminders.as_ref().unwrap();
    assert!(!reminders.use_default);
    assert_eq!(reminders.overrides[0].minutes, 10);
    let out_of_office = draft.out_of_office.as_ref().unwrap();
    assert_eq!(
        out_of_office.auto_decline_mode,
        OutOfOfficeAutoDeclineMode::DeclineNone
    );
    assert_eq!(
        *committed.reads.lock().unwrap(),
        vec![(VIEWER.to_owned(), EVENT_ID)]
    );
}

#[tokio::test]
async fn update_scopes_resolve_like_the_rest_endpoint() {
    let start = Utc.with_ymd_and_hms(2026, 10, 6, 15, 0, 0).unwrap();
    let cases: [(&str, Result<CalendarUpdateScope, &str>); 5] = [
        ("", Ok(CalendarUpdateScope::All)),
        ("scope: ALL", Ok(CalendarUpdateScope::All)),
        (
            r#"recurrenceId: "r1""#,
            Ok(CalendarUpdateScope::ThisEvent {
                recurrence_id: "r1".to_owned(),
            }),
        ),
        (
            r#"scope: THIS_EVENT, recurrenceId: "r1""#,
            Ok(CalendarUpdateScope::ThisEvent {
                recurrence_id: "r1".to_owned(),
            }),
        ),
        (
            "scope: THIS_EVENT",
            Err("a this-event update requires recurrenceId"),
        ),
    ];
    for (scope, expected) in cases {
        let mutations = Arc::new(FakeMutations::default());
        let response = execute(
            Arc::clone(&mutations),
            Arc::new(FakeCommitted::default()),
            &format!(
                r#"mutation {{ updateCalendarEvent(input: {{
                    eventId: "{EVENT_ID}", title: "Renamed",
                    time: {{ timed: {{ startsAt: "{}", endsAt: "{}" }} }}
                    {}{scope}
                }}) {{ deletedEventId }} }}"#,
                start.to_rfc3339(),
                (start + chrono::Duration::hours(1)).to_rfc3339(),
                if scope.is_empty() { "" } else { ", " },
            ),
            true,
        )
        .await;
        match expected {
            Ok(expected_scope) => {
                assert!(response.errors.is_empty(), "{scope}: {:?}", response.errors);
                let calls = mutations.calls.lock().unwrap();
                let (_, Call::Update(event_id, _, patch, scope)) = &calls[0] else {
                    panic!("expected an update");
                };
                assert_eq!(*event_id, EVENT_ID);
                assert_eq!(patch.title.as_deref(), Some("Renamed"));
                assert_eq!(*scope, expected_scope);
            }
            Err(message) => {
                assert_eq!(
                    error_extensions(&response),
                    (
                        message.to_owned(),
                        Value::from("invalid_input"),
                        Value::Bool(false)
                    )
                );
                assert!(mutations.calls.lock().unwrap().is_empty());
            }
        }
    }
}

#[tokio::test]
async fn an_update_with_a_series_scope_and_an_occurrence_is_rejected() {
    let mutations = Arc::new(FakeMutations::default());

    let response = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted::default()),
        &format!(
            r#"mutation {{ updateCalendarEvent(input: {{
                eventId: "{EVENT_ID}", scope: ALL, recurrenceId: "r1"
            }}) {{ deletedEventId }} }}"#
        ),
        true,
    )
    .await;

    assert_eq!(error_extensions(&response).1, Value::from("invalid_input"));
    assert!(mutations.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deleting_the_last_occurrence_reports_the_event_gone() {
    let mutations = Arc::new(FakeMutations::default());

    let response = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted::default()),
        &format!(
            r#"mutation {{ deleteCalendarEvent(input: {{ eventId: "{EVENT_ID}" }}) {{ {PAYLOAD} }} }}"#
        ),
        true,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let payload = &data["deleteCalendarEvent"];
    assert_eq!(payload["event"], Value::Null);
    assert_eq!(payload["occurrences"], Value::Array(Vec::new()));
    assert_eq!(payload["deletedEventId"], EVENT_ID.to_string());
    assert_eq!(
        mutations.calls.lock().unwrap()[0].1,
        Call::Delete(EVENT_ID, None, CalendarDeletionScope::All)
    );
}

#[tokio::test]
async fn a_scoped_deletion_needs_its_occurrence() {
    let mutations = Arc::new(FakeMutations::default());

    let missing = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted::default()),
        &format!(
            r#"mutation {{ deleteCalendarEvent(input: {{
                eventId: "{EVENT_ID}", scope: THIS_AND_FOLLOWING
            }}) {{ deletedEventId }} }}"#
        ),
        true,
    )
    .await;
    let scoped = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted {
            change: Some(committed_change()),
            ..Default::default()
        }),
        &format!(
            r#"mutation {{ deleteCalendarEvent(input: {{
                eventId: "{EVENT_ID}", scope: THIS_AND_FOLLOWING, recurrenceId: "r2"
            }}) {{ event {{ id }} occurrences {{ id }} }} }}"#
        ),
        true,
    )
    .await;

    assert_eq!(
        error_extensions(&missing).0,
        "a this-and-following deletion requires recurrenceId"
    );
    assert!(scoped.errors.is_empty(), "{:?}", scoped.errors);
    assert_eq!(
        mutations.calls.lock().unwrap()[0].1,
        Call::Delete(
            EVENT_ID,
            None,
            CalendarDeletionScope::ThisAndFollowing {
                recurrence_id: "r2".to_owned()
            }
        )
    );
}

#[tokio::test]
async fn an_rsvp_maps_its_response_and_ignores_an_occurrence_on_a_series_scope() {
    let mutations = Arc::new(FakeMutations::default());
    let calendar = Uuid::from_u128(0xca);

    let response = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted {
            change: Some(committed_change()),
            ..Default::default()
        }),
        &format!(
            r#"mutation {{ respondToCalendarEvent(input: {{
                eventId: "{EVENT_ID}", calendarId: "{calendar}", response: DECLINED,
                scope: ALL, recurrenceId: "r1", respondingEmail: "viewer@example.com"
            }}) {{ event {{ id }} }} }}"#
        ),
        true,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        mutations.calls.lock().unwrap()[0].1,
        Call::Rsvp(
            EVENT_ID,
            Some(calendar),
            AttendeeResponseStatus::Declined,
            CalendarRsvpScope::All,
            Some("viewer@example.com".to_owned()),
        )
    );
}

#[tokio::test]
async fn every_failure_carries_its_rest_code_and_hides_provider_details() {
    let cases = [
        (CalendarMutationError::NotFound, "not_found", false),
        (
            CalendarMutationError::OccurrenceNotFound,
            "occurrence_not_found",
            false,
        ),
        (CalendarMutationError::ReadOnly, "read_only", false),
        (
            CalendarMutationError::NoWritableCalendar,
            "no_writable_calendar",
            false,
        ),
        (CalendarMutationError::NotAttendee, "not_attendee", false),
        (
            CalendarMutationError::InvalidInput("end before start".to_owned()),
            "invalid_input",
            false,
        ),
        (
            CalendarMutationError::ReauthRequired("token revoked at 10.0.0.4".to_owned()),
            "reauth_required",
            false,
        ),
        (
            CalendarMutationError::ProviderRejected("Bad attendee".to_owned()),
            "provider_rejected",
            false,
        ),
        (
            CalendarMutationError::Retryable("upstream 10.0.0.4 timed out".to_owned()),
            "retryable",
            true,
        ),
        (
            CalendarMutationError::PersistFailed("db 10.0.0.4 down".to_owned()),
            "persist_failed",
            false,
        ),
    ];
    for (error, code, retryable) in cases {
        let mutations = Arc::new(FakeMutations::default());
        *mutations.failure.lock().unwrap() = Some(error);

        let response = execute(
            mutations,
            Arc::new(FakeCommitted::default()),
            &format!(
                r#"mutation {{ deleteCalendarEvent(input: {{ eventId: "{EVENT_ID}" }}) {{ deletedEventId }} }}"#
            ),
            true,
        )
        .await;

        let (message, actual_code, actual_retryable) = error_extensions(&response);
        assert_eq!(actual_code, Value::from(code));
        assert_eq!(actual_retryable, Value::Bool(retryable), "{code}");
        assert!(!message.contains("10.0.0.4"), "{code}: {message}");
    }
}

#[tokio::test]
async fn a_failed_read_back_is_reported_as_lagging_persistence() {
    let mutations = Arc::new(FakeMutations::default());

    let response = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted {
            fail: true,
            ..Default::default()
        }),
        &format!(
            r#"mutation {{ deleteCalendarEvent(input: {{ eventId: "{EVENT_ID}" }}) {{ deletedEventId }} }}"#
        ),
        true,
    )
    .await;

    let (message, code, retryable) = error_extensions(&response);
    assert_eq!(code, Value::from("persist_failed"));
    assert_eq!(retryable, Value::Bool(false));
    assert!(!message.contains("db-3"));
    assert_eq!(mutations.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn mutations_require_an_authenticated_viewer() {
    let mutations = Arc::new(FakeMutations::default());

    let response = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted::default()),
        &format!(
            r#"mutation {{ deleteCalendarEvent(input: {{ eventId: "{EVENT_ID}" }}) {{ deletedEventId }} }}"#
        ),
        false,
    )
    .await;

    assert_eq!(response.errors[0].message, "authentication required");
    assert!(mutations.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn malformed_times_are_invalid_input() {
    let mutations = Arc::new(FakeMutations::default());

    let response = execute(
        Arc::clone(&mutations),
        Arc::new(FakeCommitted::default()),
        r#"mutation { createCalendarEvent(input: {
            title: "Bad", time: { timed: { startsAt: "tomorrow", endsAt: "later" } }
        }) { deletedEventId } }"#,
        true,
    )
    .await;

    assert_eq!(error_extensions(&response).1, Value::from("invalid_input"));
    assert!(mutations.calls.lock().unwrap().is_empty());
}
