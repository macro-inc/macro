use axum::http::StatusCode;

use super::{CalendarJoinRequestApiError, CalendarJoinRequestErrorCode};
use crate::domain::ports::CalendarJoinRequestError;

#[test]
fn domain_failures_map_to_their_statuses_and_codes() {
    let cases = [
        (
            CalendarJoinRequestError::NotFound,
            StatusCode::NOT_FOUND,
            CalendarJoinRequestErrorCode::NotFound,
        ),
        (
            CalendarJoinRequestError::AlreadyOnCalendar,
            StatusCode::CONFLICT,
            CalendarJoinRequestErrorCode::AlreadyOnCalendar,
        ),
        (
            CalendarJoinRequestError::OrganizerOnly,
            StatusCode::CONFLICT,
            CalendarJoinRequestErrorCode::OrganizerOnly,
        ),
        (
            CalendarJoinRequestError::Internal(rootcause::report!("db down")),
            StatusCode::INTERNAL_SERVER_ERROR,
            CalendarJoinRequestErrorCode::Internal,
        ),
    ];
    for (error, status, code) in cases {
        let api = CalendarJoinRequestApiError::from(error);
        assert_eq!(api.status, status);
        assert_eq!(api.code, code);
    }
}
