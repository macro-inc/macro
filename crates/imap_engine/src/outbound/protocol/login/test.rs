use super::*;
#[test]
fn separates_bad_passwords_from_server_and_exchange_outages() {
    for text in [
        "[AUTHENTICATIONFAILED] bad password",
        "outcome: None, info: Some(\"invalid credentials\")",
        "[EXPIRED] App password expired",
    ] {
        assert_eq!(login_failure(text), Error::CredentialsRejected);
    }
    for text in [
        "[UNAVAILABLE] Authentication failed",
        "[SERVERBUG] backend",
        "[INUSE]",
        "[LIMIT]",
        "User is authenticated but not connected.",
        "temporary refusal",
    ] {
        assert_eq!(login_failure(text), Error::ConnectionUnavailable);
    }
}
