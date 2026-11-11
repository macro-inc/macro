//! View tokens for the artifact content origin.
//!
//! An artifact page can read its own URL, which carries this token, so the
//! token must be useless anywhere else. It names a distinct issuer and an
//! audience no other consumer accepts (a JWT with an audience its consumer
//! does not expect is rejected), and it carries no access level, so it fails
//! to deserialize as a document grant too. It names no viewer: the page's
//! author could decode any identity it carried.

#[cfg(test)]
mod test;

use jsonwebtoken::{
    Algorithm, DecodingKey, EncodingKey, Header, Validation, decode as jwt_decode,
    encode as jwt_encode,
};
use serde::{Deserialize, Serialize};

/// Issuer of artifact content tokens, distinct from document grants.
pub const ARTIFACT_CONTENT_ISSUER: &str = "document_storage_service/artifact_content";

/// The only audience that accepts an artifact content token.
pub const ARTIFACT_CONTENT_AUDIENCE: &str = "artifact-content";

/// Lifetime of an artifact content token in seconds (1 hour).
pub const ARTIFACT_CONTENT_TOKEN_TTL_SECS: u64 = 3600;

/// Claims of an artifact content token: read-only access to one artifact's
/// files on its content origin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactContentClaims {
    /// The artifact document.
    pub document_id: String,
    /// Expiry, in seconds since the epoch.
    pub exp: u64,
    /// Always [`ARTIFACT_CONTENT_ISSUER`].
    pub iss: String,
    /// Always [`ARTIFACT_CONTENT_AUDIENCE`].
    pub aud: String,
}

impl ArtifactContentClaims {
    /// Claims for `document_id`, expiring [`ARTIFACT_CONTENT_TOKEN_TTL_SECS`]
    /// after `now_secs`.
    pub fn new(document_id: String, now_secs: u64) -> Self {
        Self {
            document_id,
            exp: now_secs + ARTIFACT_CONTENT_TOKEN_TTL_SECS,
            iss: ARTIFACT_CONTENT_ISSUER.to_string(),
            aud: ARTIFACT_CONTENT_AUDIENCE.to_string(),
        }
    }
}

/// Sign artifact content claims with `secret` (HS256).
pub fn encode_artifact_content(
    claims: &ArtifactContentClaims,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    jwt_encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

/// Verify an artifact content token's signature, expiry, issuer and audience.
pub fn decode_artifact_content(
    token: &str,
    secret: &str,
) -> Result<ArtifactContentClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[ARTIFACT_CONTENT_ISSUER]);
    validation.set_audience(&[ARTIFACT_CONTENT_AUDIENCE]);
    let data = jwt_decode::<ArtifactContentClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}
