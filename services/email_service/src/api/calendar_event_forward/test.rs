use super::*;
use email::domain::models::EmailErr;
use macro_authorization::CODE_EXECUTION_HEADER;

fn status_and_code(error: EventForwardError) -> (StatusCode, ForwardCalendarEventErrorCode) {
    let error = ForwardCalendarEventError::from(error);
    let code = error.code;
    (error.into_response().status(), code)
}

#[test]
fn refusals_map_to_their_status_and_code() {
    assert_eq!(
        status_and_code(EventForwardError::NotFound),
        (
            StatusCode::NOT_FOUND,
            ForwardCalendarEventErrorCode::NotFound
        )
    );
    assert_eq!(
        status_and_code(EventForwardError::InvalidRecipients("no recipients")),
        (
            StatusCode::BAD_REQUEST,
            ForwardCalendarEventErrorCode::InvalidRecipients
        )
    );
    assert_eq!(
        status_and_code(EventForwardError::InboxUnavailable),
        (
            StatusCode::FORBIDDEN,
            ForwardCalendarEventErrorCode::InboxUnavailable
        )
    );
}

#[test]
fn a_failed_send_is_retryable_and_keeps_its_cause_out_of_the_message() {
    let error = ForwardCalendarEventError::from(EventForwardError::Email(EmailErr::InboxNotFound));
    assert_eq!(error.code, ForwardCalendarEventErrorCode::SendFailed);
    assert_eq!(error.message, "The invitation could not be forwarded");
    assert_eq!(error.into_response().status(), StatusCode::BAD_GATEWAY);
}

#[test]
fn the_reason_for_invalid_recipients_reaches_the_user() {
    let error = ForwardCalendarEventError::from(EventForwardError::InvalidRecipients(
        "a recipient is not an email address",
    ));
    assert_eq!(error.message, "a recipient is not an email address");
}

fn code_execution() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    headers
}

#[test]
fn an_agents_program_cannot_forward() {
    let refusal =
        refuse_program_forward(CredentialAttribution::Agent, &HeaderMap::new()).unwrap_err();
    assert_eq!(
        refusal.code,
        ForwardCalendarEventErrorCode::ConfirmationRequired
    );
    assert_eq!(refusal.message, PROGRAM_SEND_REFUSAL);
    assert_eq!(refusal.into_response().status(), StatusCode::FORBIDDEN);
}

#[test]
fn a_code_execution_request_with_a_persons_token_cannot_forward() {
    let refusal =
        refuse_program_forward(CredentialAttribution::Person, &code_execution()).unwrap_err();
    assert_eq!(
        refusal.code,
        ForwardCalendarEventErrorCode::ConfirmationRequired
    );
}

#[test]
fn a_person_in_the_app_forwards() {
    assert!(refuse_program_forward(CredentialAttribution::Person, &HeaderMap::new()).is_ok());
}

/// Owner routines send email on a schedule, as on the send route.
#[test]
fn an_owner_routine_forwards() {
    assert!(refuse_program_forward(CredentialAttribution::Routine, &HeaderMap::new()).is_ok());
}
