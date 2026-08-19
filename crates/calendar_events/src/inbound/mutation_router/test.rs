use super::*;

fn transport_of(error: CalendarMutationError) -> (StatusCode, CalendarMutationErrorCode) {
    let api_error = CalendarMutationApiError::from(error);
    (api_error.status, api_error.code)
}

#[test]
fn domain_errors_map_to_distinct_transport_semantics() {
    assert_eq!(
        transport_of(CalendarMutationError::NotFound),
        (StatusCode::NOT_FOUND, CalendarMutationErrorCode::NotFound)
    );
    assert_eq!(
        transport_of(CalendarMutationError::OccurrenceNotFound),
        (
            StatusCode::NOT_FOUND,
            CalendarMutationErrorCode::OccurrenceNotFound
        )
    );
    assert_eq!(
        transport_of(CalendarMutationError::ReadOnly),
        (StatusCode::FORBIDDEN, CalendarMutationErrorCode::ReadOnly)
    );
    assert_eq!(
        transport_of(CalendarMutationError::NoWritableCalendar),
        (
            StatusCode::CONFLICT,
            CalendarMutationErrorCode::NoWritableCalendar
        )
    );
    assert_eq!(
        transport_of(CalendarMutationError::NotAttendee),
        (StatusCode::CONFLICT, CalendarMutationErrorCode::NotAttendee)
    );
    assert_eq!(
        transport_of(CalendarMutationError::InvalidInput("bad".to_string())),
        (
            StatusCode::BAD_REQUEST,
            CalendarMutationErrorCode::InvalidInput
        )
    );
    assert_eq!(
        transport_of(CalendarMutationError::ReauthRequired("expired".to_string())),
        (
            StatusCode::FORBIDDEN,
            CalendarMutationErrorCode::ReauthRequired
        )
    );
    assert_eq!(
        transport_of(CalendarMutationError::ProviderRejected("no".to_string())),
        (
            StatusCode::CONFLICT,
            CalendarMutationErrorCode::ProviderRejected
        )
    );
    assert_eq!(
        transport_of(CalendarMutationError::Retryable("later".to_string())),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            CalendarMutationErrorCode::Retryable
        )
    );
    assert_eq!(
        transport_of(CalendarMutationError::PersistFailed("lag".to_string())),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            CalendarMutationErrorCode::PersistFailed
        )
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
fn update_scope_resolves_each_transport_pair() {
    assert_eq!(update_scope(None, None).unwrap(), CalendarUpdateScope::All);
    assert_eq!(
        update_scope(Some(CalendarUpdateScopeParam::All), None).unwrap(),
        CalendarUpdateScope::All
    );
    for scope in [None, Some(CalendarUpdateScopeParam::ThisEvent)] {
        assert_eq!(
            update_scope(scope, Some("k-1".to_string())).unwrap(),
            CalendarUpdateScope::ThisEvent {
                recurrence_id: "k-1".to_string(),
            }
        );
    }

    let missing_key = update_scope(Some(CalendarUpdateScopeParam::ThisEvent), None).unwrap_err();
    assert_eq!(missing_key.code, CalendarMutationErrorCode::InvalidInput);

    // A series update carrying an occurrence key is contradictory input;
    // dropping the key would apply a one-occurrence intent to the series.
    let stray_key =
        update_scope(Some(CalendarUpdateScopeParam::All), Some("k-1".to_string())).unwrap_err();
    assert_eq!(stray_key.code, CalendarMutationErrorCode::InvalidInput);
}

#[test]
fn attendee_body_defaults_to_required_attendance() {
    let body: CalendarAttendeeInputBody =
        serde_json::from_value(serde_json::json!({ "email": "a@b.com" })).unwrap();
    let input = CalendarAttendeeInput::from(body);
    assert!(!input.is_optional);
    assert_eq!(input.email, "a@b.com");
}
