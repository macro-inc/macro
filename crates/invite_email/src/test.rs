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
fn team_invite_rate_limit_key_is_per_invite() {
    let to_bob = InviteToTeamMetadata {
        team_name: "Acme".to_string(),
        team_id: Uuid::from_u128(1),
        team_invite_id: Uuid::from_u128(10),
        invited_by: MacroUserIdStr::try_from_email("alice@acme.com").unwrap(),
        role: None,
        sender_profile_picture_url: None,
        invitee_plan: InviteePlan::Free,
    };
    let to_carol = InviteToTeamMetadata {
        team_invite_id: Uuid::from_u128(11),
        ..to_bob.clone()
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

fn make_channel_invite() -> ChannelInviteMetadata {
    ChannelInviteMetadata {
        invited_by: MacroUserIdStr::try_from_email("sender@example.com").unwrap(),
        channel_name: "general".to_string(),
        is_direct_message: false,
        message_content: None,
        sender_profile_picture_url: None,
    }
}

#[test]
fn dm_invite_names_the_sender_not_the_recipient() {
    let invite = ChannelInviteMetadata {
        channel_name: "julia+scribbington".to_string(),
        is_direct_message: true,
        message_content: Some("Hey".to_string()),
        ..make_channel_invite()
    };
    let email = invite.format_email();
    assert_eq!(
        email.subject,
        "sender@example.com sent you a message on Macro"
    );
    assert!(
        email
            .body
            .contains("sender@example.com sent you a message on Macro.")
    );
    assert!(email.body.contains("Hey"));
    assert!(email.body.contains(">View message</a"));
    assert!(email.body.contains("/app/signup\""));
    assert!(!email.body.contains("julia+scribbington"));
    assert!(!email.body.contains("invited"));
    assert!(!email.body.contains("Join channel"));
    assert_eq!(
        invite.format_title(None).unwrap(),
        "sender@example.com sent you a message"
    );
}

#[test]
fn dm_invite_without_message_content_keeps_dm_wording() {
    let email = ChannelInviteMetadata {
        is_direct_message: true,
        ..make_channel_invite()
    }
    .format_email();
    assert!(email.body.contains("Sign up to read and reply."));
    assert!(!email.body.contains("general"));
    assert!(!email.body.contains("A shared space for your team"));
}

#[test]
fn named_channel_invite_keeps_channel_wording_with_or_without_a_message() {
    for message_content in [None, Some("Hey".to_string())] {
        let invite = ChannelInviteMetadata {
            message_content,
            ..make_channel_invite()
        };
        let email = invite.format_email();
        assert_eq!(
            email.subject,
            "sender@example.com has invited you to join #general"
        );
        assert!(email.body.contains("<strong>#general</strong> on Macro."));
        assert!(email.body.contains(">Join channel</a"));
        assert!(!email.body.contains("sent you a message"));
        assert_eq!(
            invite.format_title(None).unwrap(),
            "sender@example.com invited you to join #general"
        );
    }
}

#[test]
fn invite_email_escapes_message_content_and_channel_names() {
    for is_direct_message in [false, true] {
        let email = ChannelInviteMetadata {
            channel_name: "<script>channel</script>".to_string(),
            is_direct_message,
            message_content: Some("<script>message</script>".to_string()),
            ..make_channel_invite()
        }
        .format_email();
        assert!(!email.body.contains("<script>"));
        assert!(
            email
                .body
                .contains("&#60;script&#62;message&#60;/script&#62;")
        );
        if !is_direct_message {
            assert!(
                email
                    .body
                    .contains("&#60;script&#62;channel&#60;/script&#62;")
            );
        }
    }
}

#[test]
fn legacy_channel_invites_default_to_channel_wording() {
    for wire in [
        serde_json::json!({
            "invitedBy": "macro|sender@example.com",
            "channelName": "general",
        }),
        serde_json::json!({
            "invited_by": "macro|sender@example.com",
            "channel_name": "general",
        }),
    ] {
        let invite: ChannelInviteMetadata = serde_json::from_value(wire).unwrap();
        assert!(!invite.is_direct_message);
        assert_eq!(
            invite.format_email().subject,
            "sender@example.com has invited you to join #general"
        );
    }
}

#[test]
fn dm_invite_serde_round_trip_preserves_dm_wording() {
    let invite = ChannelInviteMetadata {
        is_direct_message: true,
        ..make_channel_invite()
    };
    let wire = serde_json::to_value(&invite).unwrap();
    assert_eq!(wire["isDirectMessage"], true);
    let parsed: ChannelInviteMetadata = serde_json::from_value(wire).unwrap();
    assert!(parsed.is_direct_message);
    assert_eq!(parsed.format_email().subject, invite.format_email().subject);
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
fn invitation_logos_keep_the_png_aspect_ratio() {
    let team_invite = InviteToTeamMetadata {
        team_name: "Acme".to_string(),
        team_id: Uuid::nil(),
        team_invite_id: Uuid::nil(),
        invited_by: MacroUserIdStr::try_from_email("sender@example.com").unwrap(),
        role: None,
        sender_profile_picture_url: None,
        invitee_plan: InviteePlan::Free,
    };
    for email in [
        make_invite().format_email(),
        make_channel_invite().format_email(),
        team_invite.format_email(),
        make_colleague_joined().format_email(),
    ] {
        let body = email.body.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(body.contains(
            r#"src="https://static-file-service.macro.com/file/b911aba9-94a6-435c-aa16-8404739f13b0" width="54" height="36""#
        ));
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

fn make_team_invite(invitee_plan: InviteePlan) -> InviteToTeamMetadata {
    InviteToTeamMetadata {
        team_name: "Acme".to_string(),
        team_id: Uuid::from_u128(1),
        team_invite_id: Uuid::from_u128(10),
        invited_by: MacroUserIdStr::try_from_email("alice@acme.com").unwrap(),
        role: None,
        sender_profile_picture_url: None,
        invitee_plan,
    }
}

/// The rendered body with whitespace collapsed, so assertions read like the email.
fn team_invite_text(invite: &InviteToTeamMetadata) -> String {
    invite
        .format_email()
        .body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn team_invite_names_the_inviter_and_the_team() {
    let invite = make_team_invite(InviteePlan::Free);
    let text = team_invite_text(&invite);

    assert_eq!(
        invite.format_email().subject,
        "alice@acme.com invited you to join Acme on Macro"
    );
    assert!(text.contains("Join Acme on Macro </h1>"));
    assert!(text.contains(
        r#"<strong style="color: #222222">alice@acme.com</strong> invited you to the <strong style="color: #222222">Acme</strong> team."#
    ));
    assert!(text.contains(">Join Acme</a"));
}

#[test]
fn team_invite_promises_pro_only_when_the_team_covers_the_seat() {
    let pro = team_invite_text(&make_team_invite(InviteePlan::Premium));
    assert!(pro.contains("Pro is included: Acme covers your seat."));
    assert!(
        pro.contains(
            "Acme covers your seat, so you get every AI model and agent at no cost to you."
        )
    );
    assert!(!pro.contains("Free to join"));

    let free = team_invite_text(&make_team_invite(InviteePlan::Free));
    assert!(free.contains("Free to join"));
    assert!(free.contains("Accept the invite to start working with Acme in Macro."));
    assert!(!free.contains("Pro is included"));
    assert!(!free.contains("covers your seat"));
}

#[test]
fn team_invite_links_the_button_and_a_pasteable_fallback() {
    let invite = make_team_invite(InviteePlan::Free);
    let url = invite.invite_url().to_string();
    let body = invite.format_email().body;

    assert!(url.ends_with("/app/team-invite?id=00000000-0000-0000-0000-00000000000a"));
    // The button's href, the fallback link's href, and its visible text.
    assert_eq!(body.matches(&url).count(), 3);
}

#[test]
fn team_invite_escapes_the_team_name() {
    let invite = InviteToTeamMetadata {
        team_name: "<script>alert(1)</script>".to_string(),
        ..make_team_invite(InviteePlan::Premium)
    };
    let body = invite.format_email().body;

    assert!(!body.contains("<script>"));
    assert!(body.contains("Join &#60;script&#62;alert(1)&#60;/script&#62; on Macro"));
}

#[test]
fn team_invite_button_names_the_team_while_it_fits() {
    assert_eq!(
        make_team_invite(InviteePlan::Free).join_label(),
        "Join Acme"
    );
    let long = InviteToTeamMetadata {
        team_name: "Northwind Traders International".to_string(),
        ..make_team_invite(InviteePlan::Free)
    };
    assert_eq!(long.join_label(), "Join team");
}

#[test]
fn team_invite_plan_keeps_its_wire_shape() {
    let wire = serde_json::to_value(make_team_invite(InviteePlan::Premium)).unwrap();
    assert_eq!(wire["inviteePlan"], "premium");

    let read: InviteToTeamMetadata = serde_json::from_value(wire).unwrap();
    assert_eq!(read.invitee_plan, InviteePlan::Premium);
}

#[test]
fn team_invite_sent_before_plans_were_recorded_reads_as_free() {
    let wire = serde_json::json!({
        "team_name": "Acme",
        "team_id": "00000000-0000-0000-0000-000000000001",
        "team_invite_id": "00000000-0000-0000-0000-00000000000a",
        "invited_by": "macro|alice@acme.com",
        "role": null,
    });

    let read: InviteToTeamMetadata = serde_json::from_value(wire).unwrap();
    assert_eq!(read.invitee_plan, InviteePlan::Free);
}
