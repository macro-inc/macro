use super::*;

#[test]
fn refusals_answer_with_the_status_the_card_branches_on() {
    let status = |error| RuntimeBypassApiError(error).into_response().status();
    assert_eq!(
        status(RuntimeBypassError::Unavailable),
        StatusCode::CONFLICT
    );
    assert_eq!(status(RuntimeBypassError::Forbidden), StatusCode::FORBIDDEN);
}
