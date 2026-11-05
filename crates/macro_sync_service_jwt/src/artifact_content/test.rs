use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::{ISSUER, decode, encode, session::decode_surface};

const SECRET: &str = "artifact-content-test-secret";
const DOCUMENT_ID: &str = "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f";

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn artifact_token() -> String {
    encode_artifact_content(
        &ArtifactContentClaims::new(
            DOCUMENT_ID.to_string(),
            Some("macro|alice@artifacts.test".to_string()),
            None,
            now_secs(),
        ),
        SECRET,
    )
    .unwrap()
}

#[test]
fn an_artifact_content_token_verifies_for_its_document() {
    let claims = decode_artifact_content(&artifact_token(), SECRET).unwrap();

    assert_eq!(claims.document_id, DOCUMENT_ID);
    assert_eq!(claims.aud, "artifact-content");
    assert!(decode_artifact_content(&artifact_token(), "another-secret").is_err());
}

/// sync-service, the AI editing path and DSS decode document grants with
/// [`decode`]; none of them may accept a token a page can read from its URL.
#[test]
fn document_grant_decoders_reject_an_artifact_content_token() {
    let token = artifact_token();

    assert!(decode::<serde_json::Value>(&token, SECRET).is_err());
    assert!(decode_surface(&token, SECRET).is_err());

    // DSS `/documents/permissions_token/validate` decodes with this validation.
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.set_issuer(&[ISSUER]);
    assert!(
        jsonwebtoken::decode::<serde_json::Value>(
            &token,
            &jsonwebtoken::DecodingKey::from_secret(SECRET.as_bytes()),
            &validation,
        )
        .is_err()
    );
}

#[test]
fn a_document_grant_is_not_an_artifact_content_token() {
    let grant = encode(
        &serde_json::json!({
            "document_id": DOCUMENT_ID,
            "access_level": "owner",
            "exp": now_secs() + 3600,
            "iss": ISSUER,
        }),
        SECRET,
    )
    .unwrap();

    assert!(decode_artifact_content(grant.as_str(), SECRET).is_err());
}
