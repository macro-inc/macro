use super::*;
use crate::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};

#[test]
fn signed_execution_token_preserves_owner_agent_and_lifetime() {
    let agent = uuid::Uuid::from_u128(0xa2a2);
    let token = encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fusion-owner".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: Some(42),
        issuer: "execution-test".into(),
        private_key: tests::PRIVATE_KEY.into(),
        expiry_seconds: 60,
        agent_id: Some(agent),
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
    forged.agent_id = Some(uuid::Uuid::from_u128(0xb0b));
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
}
