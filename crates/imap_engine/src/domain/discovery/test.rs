use super::*;
#[test]
fn independent_icloud_usernames_and_submission_security() {
    let address = format!("user@{}", "icloud.com");
    let identity = macro_user_id::email::EmailStr::parse_from_str(&address).unwrap();
    let d = discover(&identity.0).unwrap();
    let (imap, smtp) = (d.imap.unwrap(), d.smtp.unwrap());
    assert_eq!(imap.username, "user");
    assert_eq!(smtp.username, address);
    assert_eq!((smtp.port, smtp.tls), (587, TlsMode::StartTls));
}
#[test]
fn custom_domain_matches_exact_provider_suffix_and_supports_regional_workmail() {
    let identity = macro_user_id::email::EmailStr::parse_from_str("user@company.example").unwrap();
    let email = &identity.0;
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
        from_mx(email, "aspmx.l.google.com").unwrap().unwrap().steer,
        Some(DiscoverySteer::Gmail)
    );
    assert!(
        from_mx(email, "l.google.com.unrelated.example")
            .unwrap()
            .is_none()
    );
}

#[test]
fn fastmail_discovery_preserves_the_validated_identity_in_both_usernames() {
    let address =
        macro_user_id::email::EmailStr::try_from(format!("User+Tag@{}", "fastmail.com")).unwrap();
    let settings = discover(&address.0).unwrap();
    let imap = settings.imap.unwrap();
    let smtp = settings.smtp.unwrap();
    assert_eq!(imap.username, address.0.email_str());
    assert_eq!(smtp.username, address.0.email_str());
    assert_eq!(imap.host, "imap.fastmail.com");
    assert_eq!((imap.port, imap.tls), (993, TlsMode::Implicit));
    assert_eq!(smtp.host, "smtp.fastmail.com");
    assert!(settings.steer.is_none());
}
