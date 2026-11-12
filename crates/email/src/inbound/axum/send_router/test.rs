use super::*;
use axum::response::IntoResponse;
use macro_authorization::CODE_EXECUTION_HEADER;

#[test]
fn a_program_cannot_send_without_the_users_quoted_approval() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    let refusal = refuse_program_send(false, &program, None).unwrap_err();
    assert_eq!(refusal.into_response().status(), StatusCode::FORBIDDEN);
    assert!(matches!(
        refuse_program_send(true, &browser, None),
        Err(SendMessageError::ConfirmationRequired)
    ));
    assert!(matches!(
        refuse_program_send(false, &program, Some("  ")),
        Err(SendMessageError::ConfirmationRequired)
    ));
    assert!(refuse_program_send(false, &program, Some("yes, send it")).is_ok());
    assert!(refuse_program_send(false, &browser, None).is_ok());
}

#[tokio::test]
async fn a_channel_mention_program_never_sends_even_when_confirmed() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let mention = agent_correlation::context::Attribution {
        channel_mention_id: Some(uuid::Uuid::from_u128(1)),
        ..Default::default()
    };
    agent_correlation::context::scope_attribution(mention, async {
        let refusal = refuse_program_send(true, &program, Some("yes, send it")).unwrap_err();
        assert!(matches!(refusal, SendMessageError::ChannelMention));
        assert_eq!(refusal.into_response().status(), StatusCode::FORBIDDEN);
    })
    .await;
    // An agent session's confirmed program send is unchanged.
    assert!(refuse_program_send(true, &program, Some("yes, send it")).is_ok());
}
