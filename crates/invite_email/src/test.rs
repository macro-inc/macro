use super::*;

fn make_invite() -> InviteToMacro {
    InviteToMacro {
        recipient_email: EmailStr::try_from("recipient@example.com".to_string()).unwrap(),
        referral_code: ReferralCode("ABC123".to_string()),
        sender_profile_picture_url: None,
        sender_name: Some("Test User".to_string()),
        sender_email: Some("sender@example.com".to_string()),
    }
}

#[test]
fn referral_url_does_not_panic() {
    let invite = make_invite();
    let _url = invite.referral_url();
}

#[test]
fn get_url_all_environments() {
    let code = ReferralCode("CODE".to_string());
    let cases = [
        (Environment::Production, "macro.com"),
        (Environment::Develop, "dev.macro.com"),
        (Environment::Local, "localhost"),
    ];
    for (env, expected_host) in cases {
        let url = get_url(env, &code);
        assert_eq!(url.host_str().unwrap(), expected_host);
        assert!(url.as_str().contains("referral_code=CODE"));
        assert_eq!(url.path(), "/app/signup");
    }
}

#[test]
fn format_email_with_sender_name() {
    let invite = make_invite();
    let referral_url = invite.referral_url().to_string();
    let email = invite.format_email();
    assert_eq!(email.subject, "Test User has invited you to join Macro");
    assert!(
        email.body.contains(&referral_url),
        "email body should contain the referral URL"
    );
}

#[test]
fn format_email_falls_back_to_email_when_no_name() {
    let invite = InviteToMacro {
        sender_name: None,
        ..make_invite()
    };
    let email = invite.format_email();
    assert_eq!(
        email.subject,
        "sender@example.com has invited you to join Macro"
    );
    assert!(email.body.contains("sender@example.com"));
}

#[test]
fn format_email_falls_back_to_generic_when_no_name_or_email() {
    let invite = InviteToMacro {
        sender_name: None,
        sender_email: None,
        ..make_invite()
    };
    let email = invite.format_email();
    assert_eq!(email.subject, "A Macro user has invited you to join Macro");
}

#[test]
fn rate_limit_config_does_not_panic() {
    let config = InviteToMacro::rate_limit_config();
    assert_eq!(config.max_count, 1);
    assert_eq!(config.window, Duration::from_mins(MINUTES_PER_WEEK));
}

#[test]
fn rate_limit_key_does_not_panic() {
    let invite = make_invite();
    let _key = invite.rate_limit_key();
}

#[test]
fn serialization_roundtrip() {
    let invite = make_invite();
    let json = serde_json::to_string(&invite).unwrap();
    let deserialized: InviteToMacro = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.referral_code.0, "ABC123");
}

#[test]
fn deserialization_without_sender_email_uses_none() {
    let json = r#"{
        "recipient_email": "recipient@example.com",
        "referral_code": "ABC123",
        "sender_profile_picture_url": null,
        "sender_name": "Test User"
    }"#;
    let deserialized: InviteToMacro = serde_json::from_str(json).unwrap();
    assert!(deserialized.sender_email.is_none());
}
