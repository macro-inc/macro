use super::*;

#[test]
fn identities_are_case_sensitive_and_never_rewritten() {
    let upper = ProviderId::new("AA/b+=").unwrap();
    let lower = ProviderId::new("aa/b+=").unwrap();
    assert_ne!(upper, lower);
    assert_eq!(upper.as_str(), "AA/b+=");
    assert!(ProviderId::new("").is_err());
    assert!(ProviderId::new("abc\r\nInjected: yes").is_err());
}

#[test]
fn diagnostics_do_not_expose_provider_tokens_or_identifiers() {
    let token = StreamToken::new("https://graph.microsoft.com/private-cursor".into());
    assert_eq!(format!("{token:?}"), "StreamToken([REDACTED])");
    assert_eq!(
        format!("{:?}", ProviderId::new("secret").unwrap()),
        "ProviderId([REDACTED])"
    );
}
