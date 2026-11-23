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
        Err(SendMessageError::ConfirmationRequired { dialect: false })
    ));
    assert!(matches!(
        refuse_program_send(CredentialAttribution::Person, &program, Some("  ")),
        Err(SendMessageError::ConfirmationRequired { dialect: false })
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

/// A dialect program is refused in the dialect's terms; every other program
/// with today's text.
#[test]
fn a_refusal_names_the_operations_of_the_programs_code_mode() {
    let mut dialect = HeaderMap::new();
    dialect.insert(
        CODE_EXECUTION_HEADER,
        macro_authorization::DIALECT_PROGRAM.parse().unwrap(),
    );
    let mut typescript = HeaderMap::new();
    typescript.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());

    let refusal = refuse_program_send(CredentialAttribution::Agent, &dialect, None).unwrap_err();
    assert_eq!(refusal.to_string(), DIALECT_PROGRAM_SEND_REFUSAL);
    for headers in [typescript, HeaderMap::new()] {
        let refusal =
            refuse_program_send(CredentialAttribution::Agent, &headers, None).unwrap_err();
        assert_eq!(refusal.to_string(), PROGRAM_SEND_REFUSAL);
    }
}

/// Owner routines send email on a schedule: a signed owner routine token is
/// not refused here, even from a code step whose runtime marks every request
/// as code execution; an agent's token is, header or not.
#[test]
fn a_routine_owner_token_may_send() {
    let mut code_step = HeaderMap::new();
    code_step.insert(
        macro_authorization::CODE_EXECUTION_HEADER,
        "1".parse().unwrap(),
    );
    for headers in [HeaderMap::new(), code_step.clone()] {
        assert!(refuse_program_send(CredentialAttribution::Routine, &headers, None).is_ok());
        assert!(refuse_program_send(CredentialAttribution::Agent, &headers, None).is_err());
    }
}

#[test]
fn a_busy_inbox_answers_conflict_on_draft_send_and_thread_routes() {
    use crate::inbound::axum::{
        draft_router::CreateDraftError, thread_labels_router::UpdateThreadLabelError,
    };
    for response in [
        CreateDraftError::from(EmailErr::Contended).into_response(),
        SendMessageError::from(EmailErr::Contended).into_response(),
        UpdateThreadLabelError::from(EmailErr::Contended).into_response(),
    ] {
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
}
