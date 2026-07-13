//! Minting and validation for the document-permission JWTs that authorize the
//! sync service to grant document access.

use jsonwebtoken::{
    Algorithm, DecodingKey, EncodingKey, Header, Validation, decode as jwt_decode,
    encode as jwt_encode,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// JWT `iss` claim value stamped on every minted token.
pub const ISSUER: &str = "document_storage_service";

/// Lifetime of a minted token in seconds (1 hour).
pub const TOKEN_TTL_SECS: usize = 3600;

/// A signed, opaque document-permission JWT: minted by [`encode`] and consumed
/// by the sync service. Wrapping it in a distinct type keeps it from being
/// confused with a raw user bearer (e.g. a FusionAuth token) at call sites that
/// otherwise just pass `&str` around.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, derive_more::Display, derive_more::From,
)]
#[serde(transparent)]
#[display("{_0}")]
pub struct DocumentPermissionToken(String);

impl DocumentPermissionToken {
    /// Borrow the token
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume the wrapper
    pub fn into_inner(self) -> String {
        self.0
    }
}

/// Sign `claims` with `secret` (HS256), returning the minted token.
pub fn encode<C: Serialize>(
    claims: &C,
    secret: &str,
) -> Result<DocumentPermissionToken, jsonwebtoken::errors::Error> {
    let token = jwt_encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;
    Ok(DocumentPermissionToken(token))
}

/// Validate `token` against `secret` (HS256) and deserialize its claims into `C`.
/// Uses the default validation, which enforces expiry.
pub fn decode<C: DeserializeOwned>(
    token: &str,
    secret: &str,
) -> Result<C, jsonwebtoken::errors::Error> {
    let data = jwt_decode::<C>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )?;
    Ok(data.claims)
}
