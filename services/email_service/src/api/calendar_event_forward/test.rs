use super::*;
use email::domain::models::EmailErr;

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

#[tokio::test]
async fn a_channel_mention_program_cannot_forward() {
    let mention = agent_correlation::context::Attribution {
        channel_mention_id: Some(uuid::Uuid::from_u128(1)),
        ..Default::default()
    };
    let refusal = agent_correlation::context::scope_attribution(mention, async {
        refuse_channel_mention().unwrap_err()
    })
    .await;
    assert_eq!(refusal.message, email::CHANNEL_MENTION_SEND_REFUSAL);
    assert_eq!(refusal.into_response().status(), StatusCode::FORBIDDEN);
    // Anyone else's forward is unchanged.
    assert!(refuse_channel_mention().is_ok());
}
