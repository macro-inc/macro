use super::*;

const SECRET: &str = "surface-token-secret";

fn level() -> AccessLevel {
    let user = MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap();
    let token = encode_surface_token(user, "surface-1".into(), AccessLevel::Edit, SECRET).unwrap();
    macro_sync_service_jwt::decode::<DocumentPermissionsToken>(token.as_str(), SECRET)
        .unwrap()
        .access_level
}

/// A surface token minted under a scope that caps document tokens (a
/// background job) grants view only; elsewhere it keeps its level.
#[tokio::test]
async fn a_capped_scope_mints_only_view_surface_tokens() {
    assert_eq!(level(), AccessLevel::Edit);
    for (scope, expected) in [
        (
            agent_correlation::scope::SessionScope::Job,
            AccessLevel::View,
        ),
        (
            agent_correlation::scope::SessionScope::NoSend,
            AccessLevel::Edit,
        ),
    ] {
        let minted = agent_correlation::context::scope_attribution(
            agent_correlation::context::Attribution {
                scope: Some(scope),
                ..Default::default()
            },
            async { level() },
        )
        .await;
        assert_eq!(minted, expected, "{scope:?}");
    }
}
