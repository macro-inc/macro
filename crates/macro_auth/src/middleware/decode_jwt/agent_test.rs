use super::*;
use crate::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};

#[test]
fn signed_execution_token_preserves_owner_agent_and_lifetime() {
    let agent = uuid::Uuid::from_u128(0xa2a2);
    let token = encode_macro_api_token(EncodeMacroApiTokenArgs {
        agent_correlation_id: Some(uuid::Uuid::from_u128(123)),
        agent_session_id: Some(uuid::Uuid::from_u128(456)),
        fusionauth_id: "fusion-owner".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: Some(42),
        issuer: "execution-test".into(),
        private_key: tests::PRIVATE_KEY.into(),
        expiry_seconds: 60,
        agent_id: Some(agent),
        agent_via: Some("Claude Code".into()),
        routine_id: None,
        agent_scope: None,
    })
    .unwrap();
    let args = JwtValidationArgs {
        audience: Audience::new_testing(""),
        issuer: Issuer::new_testing(""),
        jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("")),
        macro_api_token_issuer: MacroApiTokenIssuer::new_testing("execution-test"),
        macro_api_token_public_key: LocalOrRemoteSecret::Local(
            MacroApiTokenPublicKey::new_testing(tests::PUBLIC_KEY),
        ),
    };
    let JwtToken::MacroApiToken(claims) = handler(&args, &token).unwrap() else {
        panic!("expected Macro API token");
    };
    assert_eq!(claims.agent_id, Some(agent));
    assert_eq!(
        claims.agent_correlation_id,
        Some(uuid::Uuid::from_u128(123))
    );
    assert_eq!(claims.agent_session_id, Some(uuid::Uuid::from_u128(456)));
    assert_eq!(claims.agent_via.as_deref(), Some("Claude Code"));
    assert_eq!(claims.macro_user_id, "macro|owner@example.com");
    assert_eq!(claims.macro_organization_id, Some(42));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;
    assert!(claims.exp <= now + 60);
    assert!(claims.exp > now);

    // An edited attribution cannot be signed with a user's HMAC credential.
    let mut forged = claims;
    forged.agent_correlation_id = Some(uuid::Uuid::from_u128(0xb0b));
    let mut header = jsonwebtoken::Header::new(Algorithm::HS256);
    header.kid = Some("macro".into());
    let token = jsonwebtoken::encode(
        &header,
        &forged,
        &jsonwebtoken::EncodingKey::from_secret(b"user-secret"),
    )
    .unwrap();
    assert!(handler(&args, &token).is_err());
}

#[test]
fn legacy_user_token_has_no_agent_attribution() {
    let claims: MacroApiToken = serde_json::from_value(serde_json::json!({
        "exp": 12345, "iss": "test", "fusion_user_id": "fusion-owner",
        "macro_user_id": "macro|owner@example.com", "macro_organization_id": null,
    }))
    .unwrap();
    assert_eq!(claims.agent_id, None);
    assert_eq!(claims.agent_via, None);
    assert_eq!(claims.agent_correlation_id, None);
    assert_eq!(claims.agent_session_id, None);
    assert_eq!(claims.routine_id, None);
}

#[test]
fn signed_routine_token_carries_its_routine_and_rejects_a_forged_one() {
    let routine = uuid::Uuid::from_u128(0x7001);
    let token = encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fusion-owner".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "routine-test".into(),
        private_key: tests::PRIVATE_KEY.into(),
        expiry_seconds: 60,
        agent_id: None,
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: Some(routine),
        agent_scope: None,
    })
    .unwrap();
    let args = JwtValidationArgs {
        audience: Audience::new_testing(""),
        issuer: Issuer::new_testing(""),
        jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("")),
        macro_api_token_issuer: MacroApiTokenIssuer::new_testing("routine-test"),
        macro_api_token_public_key: LocalOrRemoteSecret::Local(
            MacroApiTokenPublicKey::new_testing(tests::PUBLIC_KEY),
        ),
    };
    let JwtToken::MacroApiToken(claims) = handler(&args, &token).unwrap() else {
        panic!("expected Macro API token");
    };
    assert_eq!(claims.routine_id, Some(routine));
    assert_eq!(claims.agent_id, None);

    // A payload without the routine cannot borrow the routine token's signature.
    let plain_token = encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fusion-owner".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "routine-test".into(),
        private_key: tests::PRIVATE_KEY.into(),
        expiry_seconds: 60,
        agent_id: None,
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: None,
        agent_scope: None,
    })
    .unwrap();
    let [header, _, signature]: [&str; 3] =
        token.split('.').collect::<Vec<_>>().try_into().unwrap();
    let plain_payload = plain_token.split('.').nth(1).unwrap();
    let spliced = format!("{header}.{plain_payload}.{signature}");
    assert!(handler(&args, &spliced).is_err());

    // Another routine cannot be signed with a user's HMAC credential.
    let mut forged = claims;
    forged.routine_id = Some(uuid::Uuid::from_u128(0x7002));
    let mut header = jsonwebtoken::Header::new(Algorithm::HS256);
    header.kid = Some("macro".into());
    let forged_token = jsonwebtoken::encode(
        &header,
        &forged,
        &jsonwebtoken::EncodingKey::from_secret(b"user-secret"),
    )
    .unwrap();
    assert!(handler(&args, &forged_token).is_err());
}

#[test]
fn a_signed_scope_survives_decoding_and_cannot_be_dropped() {
    let mint = |agent_scope: Option<&str>| {
        encode_macro_api_token(EncodeMacroApiTokenArgs {
            fusionauth_id: "fusion-owner".into(),
            macro_user_id: "macro|owner@example.com".into(),
            organization_id: None,
            issuer: "scope-test".into(),
            private_key: tests::PRIVATE_KEY.into(),
            expiry_seconds: 60,
            agent_id: Some(uuid::Uuid::from_u128(0xa3a3)),
            agent_via: None,
            agent_correlation_id: Some(uuid::Uuid::from_u128(0xc0c0)),
            agent_session_id: None,
            routine_id: None,
            agent_scope: agent_scope.map(str::to_owned),
        })
        .unwrap()
    };
    let args = JwtValidationArgs {
        audience: Audience::new_testing(""),
        issuer: Issuer::new_testing(""),
        jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("")),
        macro_api_token_issuer: MacroApiTokenIssuer::new_testing("scope-test"),
        macro_api_token_public_key: LocalOrRemoteSecret::Local(
            MacroApiTokenPublicKey::new_testing(tests::PUBLIC_KEY),
        ),
    };
    let scoped = mint(Some("generation"));
    let JwtToken::MacroApiToken(claims) = handler(&args, &scoped).unwrap() else {
        panic!("expected Macro API token");
    };
    assert_eq!(claims.agent_scope.as_deref(), Some("generation"));

    let JwtToken::MacroApiToken(unscoped) = handler(&args, &mint(None)).unwrap() else {
        panic!("expected Macro API token");
    };
    assert_eq!(unscoped.agent_scope, None);

    // The scoped token's signature does not cover a payload without the scope.
    let [header, _, signature]: [&str; 3] =
        scoped.split('.').collect::<Vec<_>>().try_into().unwrap();
    let unscoped_payload = mint(None).split('.').nth(1).unwrap().to_owned();
    assert!(handler(&args, &format!("{header}.{unscoped_payload}.{signature}")).is_err());
}
