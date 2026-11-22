//! Legacy mention claims can only narrow an independently verified scope.
use super::*;

fn verified_mention(scope: Option<&str>) -> MacroApiToken {
    let bearer = encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: Some(Uuid::from_u128(3)),
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: None,
        channel_mention_id: Some(Uuid::from_u128(908)),
        agent_scope: scope.map(str::to_owned),
    })
    .unwrap();
    match macro_auth::middleware::decode_jwt::handler(
        &JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        &bearer,
    )
    .unwrap()
    {
        JwtToken::MacroApiToken(token) => token,
        _ => panic!("expected verified Macro API credential"),
    }
}

#[test]
fn legacy_mentions_keep_the_new_restriction_on_allowed_reads() {
    for scope in [None, Some("no_send"), Some("future_scope")] {
        let token = verified_mention(scope);
        let (parts, _) = Request::builder()
            .uri("/documents/00000000-0000-0000-0000-000000000001/markdown")
            .body(())
            .unwrap()
            .into_parts();
        let accepted = checked_signed_scope(Some(&token), &parts).unwrap();
        assert_eq!(
            accepted.known().map(SessionScope::as_str),
            Some("channel_mention"),
            "original scope {scope:?}"
        );
    }
}

#[test]
fn a_mention_claim_cannot_widen_an_unknown_signed_scopes_get_only_fallback() {
    let token = verified_mention(Some("future_scope"));
    let (parts, _) = Request::builder()
        .method("POST")
        .uri("/search")
        .body(())
        .unwrap()
        .into_parts();
    assert!(checked_signed_scope(Some(&token), &parts).is_err());
}
