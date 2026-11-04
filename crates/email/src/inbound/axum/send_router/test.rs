use super::*;
use axum::response::IntoResponse;
use macro_authorization::CODE_EXECUTION_HEADER;

#[test]
fn a_program_cannot_send_without_the_user_seeing_the_email() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    let refusal = refuse_program_send(false, &program).unwrap_err();
    assert_eq!(refusal.into_response().status(), StatusCode::FORBIDDEN);
    assert!(matches!(
        refuse_program_send(true, &browser),
        Err(SendMessageError::ConfirmationRequired)
    ));
    assert!(refuse_program_send(false, &browser).is_ok());
}
