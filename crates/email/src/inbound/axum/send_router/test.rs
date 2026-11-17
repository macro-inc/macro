use super::*;
use axum::response::IntoResponse;
use macro_authorization::CODE_EXECUTION_HEADER;

#[test]
fn a_program_cannot_send_without_the_users_quoted_approval() {
    let mut program = HeaderMap::new();
    program.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let browser = HeaderMap::new();

    let refusal = refuse_program_send(CredentialAttribution::Person, &program, None).unwrap_err();
    assert_eq!(refusal.into_response().status(), StatusCode::FORBIDDEN);
    assert!(matches!(
        refuse_program_send(CredentialAttribution::Agent, &browser, None),
        Err(SendMessageError::ConfirmationRequired)
    ));
    assert!(matches!(
        refuse_program_send(CredentialAttribution::Person, &program, Some("  ")),
        Err(SendMessageError::ConfirmationRequired)
    ));
    assert!(
        refuse_program_send(
            CredentialAttribution::Person,
            &program,
            Some("yes, send it")
        )
        .is_ok()
    );
    assert!(refuse_program_send(CredentialAttribution::Person, &browser, None).is_ok());
}

/// Owner routines send email on a schedule: a routine owner token alone is
/// not refused here; only an agent's token or a code-mode request is.
#[test]
fn a_routine_owner_token_may_send() {
    assert!(refuse_program_send(CredentialAttribution::Routine, &HeaderMap::new(), None).is_ok());
}
