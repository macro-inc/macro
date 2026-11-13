use chrono::TimeZone;

use super::*;

#[test]
fn a_cursor_round_trips_and_garbage_is_a_bad_request() {
    let cursor = WakeCursor {
        started_at: Utc.with_ymd_and_hms(2026, 11, 11, 9, 0, 0).unwrap(),
        wake_id: "w/1".to_owned(),
    };
    let encoded = encode_cursor(&cursor).unwrap();
    assert_eq!(decode_cursor(&encoded).unwrap(), cursor);

    let garbage = decode_cursor("not a cursor").unwrap_err().into_response();
    assert_eq!(garbage.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn errors_answer_with_their_status() {
    for (error, status) in [
        (WakeError::NotFound, StatusCode::NOT_FOUND),
        (WakeError::Forbidden, StatusCode::FORBIDDEN),
        (WakeError::Invalid("x".to_owned()), StatusCode::BAD_REQUEST),
        (WakeError::Conflict("w".to_owned()), StatusCode::CONFLICT),
        (
            WakeError::Storage(rootcause::report!("down")),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        assert_eq!(AgentWakesApiError(error).into_response().status(), status);
    }
}

#[test]
fn a_path_id_that_is_not_a_user_id_is_not_found() {
    let response = agent_id("not-a-user".to_owned())
        .unwrap_err()
        .into_response();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
