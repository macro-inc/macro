use super::*;

#[test]
fn call_invitation_links_directly_to_guest_join_and_escapes_titles() {
    let invitation = CallInvite {
        title: "Review <script>alert(1)</script>".to_string(),
        share_token: "server-issued-test-token".to_string(),
        invited_by: MacroUserIdStr::try_from_email("host@example.com").unwrap(),
        recipient_email: "guest@outside.example".to_string(),
    };
    let email = invitation.format_email();
    assert!(
        email
            .body
            .contains("/app/meet/join/server-issued-test-token")
    );
    assert!(email.body.contains("No Macro account needed"));
    assert!(!email.body.contains("/signup"));
    assert!(!email.body.contains("<script>"));
    assert!(email.subject.contains("host@example.com"));
}

fn make_colleague_joined() -> ColleagueJoinedMacro {
    ColleagueJoinedMacro {
        team_name: "Acme".to_string(),
        joined_by: MacroUserIdStr::try_from_email("alice@acme.com").unwrap(),
        joined_name: Some("Alice Example".to_string()),
        recipient_email: EmailStr::try_from("bob@acme.com".to_string()).unwrap(),
    }
}

#[test]
fn colleague_joined_names_the_colleague_and_links_to_signup() {
    let email = make_colleague_joined().format_email();
    assert_eq!(email.subject, "Alice Example joined Macro");
    assert!(
        email
            .body
            .contains("Alice Example (alice@acme.com) joined Macro with the")
    );
    assert!(email.body.contains("<strong>Acme</strong> team."));
    assert!(
        email
            .body
            .contains("Sign up with <strong>bob@acme.com</strong>")
    );
    assert!(email.body.contains("/app/signup\""));
    assert!(email.body.contains(">Join Acme</a"));
    assert!(!email.body.contains("referral_code"));
}

#[test]
fn colleague_joined_falls_back_to_the_email_without_a_usable_name() {
    for joined_name in [None, Some(" \n\t\u{7} ".to_string())] {
        let email = ColleagueJoinedMacro {
            joined_name,
            ..make_colleague_joined()
        }
        .format_email();
        assert_eq!(email.subject, "alice@acme.com joined Macro");
        assert!(email.body.contains("alice@acme.com joined Macro with the"));
        assert!(!email.body.contains("(alice@acme.com)"));
    }
}

#[test]
fn colleague_joined_puts_long_multiline_names_on_one_capped_line() {
    let email = ColleagueJoinedMacro {
        joined_name: Some(format!("  Alice\r\nExample\t\u{0}{}", "x".repeat(100))),
        ..make_colleague_joined()
    }
    .format_email();
    assert_eq!(
        email.subject,
        format!("Alice Example {} joined Macro", "x".repeat(50))
    );
}

#[test]
fn colleague_joined_escapes_the_untrusted_name_in_the_body() {
    let email = ColleagueJoinedMacro {
        joined_name: Some("<b>x</b>".to_string()),
        ..make_colleague_joined()
    }
    .format_email();
    assert_eq!(email.subject, "<b>x</b> joined Macro");
    assert!(!email.body.contains("<b>x</b>"));
    assert!(
        email
            .body
            .contains("&#60;b&#62;x&#60;/b&#62; (alice@acme.com)")
    );
}

#[test]
fn colleague_joined_rate_limit_key_is_per_recipient() {
    let to_bob = make_colleague_joined();
    let to_carol = ColleagueJoinedMacro {
        recipient_email: EmailStr::try_from("carol@acme.com".to_string()).unwrap(),
        ..make_colleague_joined()
    };
    assert_eq!(
        to_bob.rate_limit_key().as_bytes(),
        to_bob.clone().rate_limit_key().as_bytes()
    );
    assert_ne!(
        to_bob.rate_limit_key().as_bytes(),
        to_carol.rate_limit_key().as_bytes()
    );
}

#[test]
fn colleague_joined_serde_round_trip_keeps_the_wire_shape() {
    let wire = serde_json::json!({
        "team_name": "Acme",
        "joined_by": "macro|alice@acme.com",
        "joined_name": "Alice Example",
        "recipient_email": "bob@acme.com",
    });
    assert_eq!(serde_json::to_value(make_colleague_joined()).unwrap(), wire);
    let parsed: ColleagueJoinedMacro = serde_json::from_value(wire).unwrap();
    assert_eq!(parsed.team_name, "Acme");
    assert_eq!(parsed.joined_by.to_string(), "macro|alice@acme.com");
    assert_eq!(parsed.joined_name.as_deref(), Some("Alice Example"));
    assert_eq!(String::from(parsed.recipient_email), "bob@acme.com");
}

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
