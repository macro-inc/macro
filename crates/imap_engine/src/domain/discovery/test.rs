use super::*;
#[test]
fn independent_icloud_usernames_and_submission_security() {
    let address = format!("user@{}", "icloud.com");
    let d = discover(&address).unwrap();
    let (imap, smtp) = (d.imap.unwrap(), d.smtp.unwrap());
    assert_eq!(imap.username, "user");
    assert_eq!(smtp.username, address);
    assert_eq!((smtp.port, smtp.tls), (587, TlsMode::StartTls));
}
#[test]
fn custom_domain_matches_exact_provider_suffix_and_supports_regional_workmail() {
    let email = "user@company.example";
    assert!(discover(email).unwrap().imap.is_none());
    assert_eq!(
        from_mx(email, "INBOUND-SMTP.us-east-1.amazonaws.com.")
            .unwrap()
            .unwrap()
            .imap
            .unwrap()
            .host,
        "imap.mail.us-east-1.awsapps.com"
    );
    assert_eq!(
        from_mx(email, "aspmx.l.google.com")
            .unwrap()
            .unwrap()
            .steer
            .as_deref(),
        Some("gmail")
    );
    assert!(
        from_mx(email, "l.google.com.unrelated.example")
            .unwrap()
            .is_none()
    );
}
