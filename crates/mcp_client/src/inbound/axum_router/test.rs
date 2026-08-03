use super::*;

fn params(
    code: Option<&str>,
    state: Option<&str>,
    error: Option<&str>,
    error_description: Option<&str>,
) -> AuthCallbackParams {
    AuthCallbackParams {
        code: code.map(String::from),
        state: state.map(String::from),
        error: error.map(String::from),
        error_description: error_description.map(String::from),
    }
}

#[test]
fn successful_callback_yields_code_and_state() {
    let result = parse_callback_params(params(Some("a-code"), Some("a-state"), None, None));
    assert!(matches!(result, Ok((code, state)) if code == "a-code" && state == "a-state"));
}

#[test]
fn provider_rejection_is_reported_with_description() {
    let result = parse_callback_params(params(
        None,
        Some("a-state"),
        Some("access_denied"),
        Some("user declined"),
    ));
    let Err(McpHandlerErr::OAuthRejected(message)) = result else {
        panic!("expected OAuthRejected, got {result:?}");
    };
    assert_eq!(message, "access_denied: user declined");
}

#[test]
fn provider_rejection_without_description_uses_bare_error() {
    let result = parse_callback_params(params(None, Some("a-state"), Some("access_denied"), None));
    let Err(McpHandlerErr::OAuthRejected(message)) = result else {
        panic!("expected OAuthRejected, got {result:?}");
    };
    assert_eq!(message, "access_denied");
}

#[test]
fn error_takes_precedence_over_a_stray_code() {
    // Providers shouldn't send both, but if they do, the rejection is authoritative.
    let result = parse_callback_params(params(
        Some("a-code"),
        Some("a-state"),
        Some("access_denied"),
        None,
    ));
    assert!(matches!(result, Err(McpHandlerErr::OAuthRejected(_))));
}

#[test]
fn missing_code_and_error_is_malformed() {
    let result = parse_callback_params(params(None, Some("a-state"), None, None));
    assert!(matches!(result, Err(McpHandlerErr::MalformedCallback)));
}

#[test]
fn missing_state_without_error_is_malformed() {
    let result = parse_callback_params(params(Some("a-code"), None, None, None));
    assert!(matches!(result, Err(McpHandlerErr::MalformedCallback)));
}
