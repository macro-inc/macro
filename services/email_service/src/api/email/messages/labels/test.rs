use super::*;

#[test]
fn a_busy_inbox_answers_conflict() {
    let response = error_response(MessageLabelError::<std::io::Error>::Contended);
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[test]
fn a_failed_queue_write_stays_internal() {
    let response = error_response(MessageLabelError::Command(std::io::Error::other(
        "connection lost",
    )));
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
