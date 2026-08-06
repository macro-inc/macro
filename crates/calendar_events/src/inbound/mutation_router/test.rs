use super::*;

fn status_of(error: CalendarMutationError) -> StatusCode {
    CalendarMutationApiError::from(error).status
}

#[test]
fn domain_errors_map_to_distinct_transport_semantics() {
    assert_eq!(
        status_of(CalendarMutationError::NotFound),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status_of(CalendarMutationError::ReadOnly),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status_of(CalendarMutationError::NoWritableCalendar),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status_of(CalendarMutationError::NotAttendee),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status_of(CalendarMutationError::InvalidInput("bad".to_string())),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        status_of(CalendarMutationError::ReauthRequired("expired".to_string())),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status_of(CalendarMutationError::ProviderRejected("no".to_string())),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status_of(CalendarMutationError::Retryable("later".to_string())),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        status_of(CalendarMutationError::PersistFailed("lag".to_string())),
        StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[test]
fn provider_rejections_surface_their_message_but_internal_failures_do_not() {
    let rejected = CalendarMutationApiError::from(CalendarMutationError::ProviderRejected(
        "guests cannot invite others".to_string(),
    ));
    assert_eq!(rejected.message, "guests cannot invite others");

    let retryable = CalendarMutationApiError::from(CalendarMutationError::Retryable(
        "connection reset by peer at 10.0.0.7".to_string(),
    ));
    assert!(!retryable.message.contains("10.0.0.7"));
}

#[test]
fn attendee_body_defaults_to_required_attendance() {
    let body: CalendarAttendeeInputBody =
        serde_json::from_value(serde_json::json!({ "email": "a@b.com" })).unwrap();
    let input = CalendarAttendeeInput::from(body);
    assert!(!input.is_optional);
    assert_eq!(input.email, "a@b.com");
}
