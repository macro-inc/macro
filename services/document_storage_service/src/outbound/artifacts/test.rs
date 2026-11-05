use super::*;

#[test]
fn a_minted_view_token_verifies_for_its_document_only_with_the_secret() {
    let tokens = PermissionTokenViewTokens::new("artifact-test-secret");

    let minted = tokens
        .mint(
            &Viewer {
                user_id: Some("macro|alice@artifacts.test".to_string()),
                actor: None,
            },
            "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f",
            AccessLevel::View,
        )
        .unwrap();

    assert_eq!(
        tokens.verify(&minted.token),
        Some(VerifiedToken {
            document_id: "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f".to_string(),
        })
    );
    assert_eq!(
        PermissionTokenViewTokens::new("another-secret").verify(&minted.token),
        None
    );
    assert_eq!(tokens.verify("not-a-token"), None);
}

#[test]
fn anonymous_viewers_get_a_token_too() {
    let tokens = PermissionTokenViewTokens::new("artifact-test-secret");

    let minted = tokens
        .mint(
            &Viewer::default(),
            "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f",
            AccessLevel::View,
        )
        .unwrap();

    assert!(tokens.verify(&minted.token).is_some());
}
