use super::*;

#[test]
fn settle_reauth_returns_successful_token() {
    let result = settle_reauth_result(Ok(AccessToken::new("token")), false).unwrap();

    assert_eq!(result.unwrap().expose_secret(), "token");
}

#[test]
fn settle_reauth_is_terminal_after_health_is_persisted() {
    let result = settle_reauth_result(Err(EmailApiError::AuthRequired), true).unwrap();

    assert!(result.is_none());
}

#[test]
fn settle_reauth_retries_when_health_was_not_persisted() {
    let error = settle_reauth_result(Err(EmailApiError::AuthRequired), false).unwrap_err();

    assert!(matches!(
        error.downcast_ref::<EmailApiError>(),
        Some(EmailApiError::AuthRequired)
    ));
}

#[test]
fn settle_reauth_retries_transient_probe_failures() {
    let error = settle_reauth_result(
        Err(EmailApiError::Transient {
            message: "temporary failure".to_string(),
        }),
        true,
    )
    .unwrap_err();

    assert!(matches!(
        error.downcast_ref::<EmailApiError>(),
        Some(EmailApiError::Transient { .. })
    ));
}
