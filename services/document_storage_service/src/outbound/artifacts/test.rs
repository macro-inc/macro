use super::*;

#[test]
fn a_minted_view_token_verifies_for_its_document_only_with_the_secret() {
    let tokens = ArtifactContentViewTokens::new("artifact-test-secret");

    let minted = tokens.mint("0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f").unwrap();

    assert_eq!(
        tokens.verify(&minted.token),
        Some(VerifiedToken {
            document_id: "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f".to_string(),
        })
    );
    assert_eq!(
        ArtifactContentViewTokens::new("another-secret").verify(&minted.token),
        None
    );
    assert_eq!(tokens.verify("not-a-token"), None);
}

/// A page can read the token from its URL; sync-service and DSS must not
/// accept it as a document grant.
#[test]
fn a_view_token_is_not_a_document_grant() {
    let tokens = ArtifactContentViewTokens::new("artifact-test-secret");
    let minted = tokens.mint("0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f").unwrap();

    let as_grant =
        macro_sync_service_jwt::decode::<serde_json::Value>(&minted.token, "artifact-test-secret");
    assert!(as_grant.is_err());
}
