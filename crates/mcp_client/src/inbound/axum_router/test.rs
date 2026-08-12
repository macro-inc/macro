use super::*;
use crate::domain::models::MacroUserIdStr;
use macro_user_id::cowlike::CowLike;

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

#[test]
fn clean_credential_trims_and_rejects_empty() {
    assert_eq!(
        clean_credential("  abc  ".to_string()).as_deref(),
        Some("abc")
    );
    assert_eq!(clean_credential("   ".to_string()), None);
    assert_eq!(clean_credential("".to_string()), None);
}

#[test]
fn client_secret_without_client_id_is_rejected() {
    assert!(matches!(
        validate_oauth_credentials(None, Some("secret")),
        Err(McpHandlerErr::InvalidCredentials(_))
    ));
    assert!(validate_oauth_credentials(Some("id"), Some("secret")).is_ok());
    assert!(validate_oauth_credentials(Some("id"), None).is_ok());
    assert!(validate_oauth_credentials(None, None).is_ok());
}

#[test]
fn response_reflects_pre_registered_credentials() {
    let record = McpServerRecord {
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com")
            .expect("valid test user id")
            .into_owned(),
        url: "https://mcp.hubspot.com".to_string(),
        server_name: "HubSpot".to_string(),
        credentials: None,
        enabled: true,
        client_id: Some("client-123".to_string()),
        client_secret: Some("secret".to_string()),
    };
    let response = ServerResponse::from_record(&record);
    assert_eq!(response.client_id.as_deref(), Some("client-123"));
    assert!(response.has_client_secret);
    assert!(!response.authenticated);

    let no_creds = McpServerRecord {
        client_id: None,
        client_secret: None,
        ..record
    };
    let response = ServerResponse::from_record(&no_creds);
    assert_eq!(response.client_id, None);
    assert!(!response.has_client_secret);
}
