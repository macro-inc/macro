//! Typed sync-session identities and isolated surface grants.
//!
//! Surface storage keys are `surface:<lowercase hyphenated UUID>`. Document
//! keys retain their original spelling and have no prefix. UUID-only identities
//! keep document keys out of the reserved surface namespace.

use std::{fmt, str::FromStr};

use jsonwebtoken::{
    Algorithm, DecodingKey, EncodingKey, Header, Validation, decode as jwt_decode,
    encode as jwt_encode,
};
use serde::{Deserialize, Serialize};

use crate::ISSUER;

/// The authorization and storage namespace of a sync session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    /// An existing document session, stored under its unprefixed document ID.
    Document,
    /// An isolated collaborative surface session.
    Surface,
}

/// An identifier was not a hyphenated UUID (`8-4-4-4-12` ASCII hex digits).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidSessionId;

impl fmt::Display for InvalidSessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("session ID must be a hyphenated UUID")
    }
}

impl std::error::Error for InvalidSessionId {}

// Validate only the wire grammar; UUID generation/version policy belongs to the
// caller. This shared worker/backend crate needs no UUID or randomness dependency.
fn validate_id(id: &str) -> Result<(), InvalidSessionId> {
    if id.len() != 36 {
        return Err(InvalidSessionId);
    }
    for (index, byte) in id.bytes().enumerate() {
        let valid = match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        };
        if !valid {
            return Err(InvalidSessionId);
        }
    }
    Ok(())
}

/// A surface UUID in canonical lowercase, hyphenated form.
///
/// Construction and deserialization both validate the ID. Alternate UUID forms
/// (URNs, braces, or unhyphenated hex) and already-prefixed storage keys are rejected.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String")]
pub struct SurfaceId(String);

impl SurfaceId {
    /// Borrow the canonical UUID, without its storage namespace prefix.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for SurfaceId {
    type Err = InvalidSessionId;

    fn from_str(id: &str) -> Result<Self, Self::Err> {
        validate_id(id)?;
        Ok(Self(id.to_ascii_lowercase()))
    }
}

impl TryFrom<String> for SurfaceId {
    type Error = InvalidSessionId;

    fn try_from(id: String) -> Result<Self, Self::Error> {
        id.parse()
    }
}

impl fmt::Display for SurfaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A validated authorization target. Matching UUIDs in different kinds are not
/// equal and never produce the same storage key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionIdentity {
    kind: SessionKind,
    id: String,
}

impl SessionIdentity {
    /// Validate a route/persisted identity. Document spelling is preserved;
    /// surface IDs are canonicalized before comparison or storage.
    pub fn new(kind: SessionKind, id: &str) -> Result<Self, InvalidSessionId> {
        match kind {
            SessionKind::Document => {
                validate_id(id)?;
                Ok(Self {
                    kind,
                    id: id.to_owned(),
                })
            }
            SessionKind::Surface => Ok(Self::surface(id.parse()?)),
        }
    }

    /// Construct an isolated identity from an already validated surface ID.
    pub fn surface(id: SurfaceId) -> Self {
        Self {
            kind: SessionKind::Surface,
            id: id.0,
        }
    }

    /// The namespace that must match the grant as well as the route.
    pub fn kind(&self) -> SessionKind {
        self.kind
    }

    /// The unprefixed ID. Do not use this alone as an authorization target.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The common base key for Durable Objects and external persistence.
    /// Existing document names are unchanged.
    pub fn storage_key(&self) -> String {
        match self.kind {
            SessionKind::Document => self.id.clone(),
            SessionKind::Surface => format!("surface:{}", self.id),
        }
    }
}

/// Permission carried by a surface grant. Internal/admin credentials are not
/// surface grants; write policy is enforced by the surface access boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceAccessLevel {
    /// Read-only access.
    View,
    /// Comment access, not permission for arbitrary CRDT writes.
    Comment,
    /// Permission to edit surface content.
    Edit,
    /// Owner access.
    Owner,
}

/// The mandatory surface-claim discriminator. A document kind cannot be
/// constructed or deserialized into this type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SurfaceSessionKind {
    /// An isolated collaborative surface.
    Surface,
}

/// A grant for exactly one isolated surface, never a document grant.
///
/// The wire format requires `session_kind: "surface"` and `surface_id`.
/// There is deliberately no `document_id` fallback. Unknown fields are rejected
/// so a dual document/surface grant cannot be decoded as a surface grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceClaims {
    /// Required explicit discriminator, with no default for legacy tokens.
    pub session_kind: SurfaceSessionKind,
    /// The canonical, surface-scoped target ID.
    pub surface_id: SurfaceId,
    /// The user, when present.
    pub user_id: Option<String>,
    /// The parent-derived surface permission.
    pub access_level: SurfaceAccessLevel,
    /// Optional attribution actor, matching the document transport convention.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    /// Expiry as Unix seconds; consumers must retain this for open sockets.
    pub exp: usize,
    /// Issuer, validated against [`ISSUER`] by [`decode_surface`].
    pub iss: String,
}

impl SurfaceClaims {
    /// The complete authorization target; compare this with the route identity.
    pub fn session_identity(&self) -> SessionIdentity {
        SessionIdentity::surface(self.surface_id.clone())
    }
}

/// A signed surface grant, distinct from the legacy document token wrapper.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, derive_more::Display, derive_more::From,
)]
#[serde(transparent)]
#[display("{_0}")]
pub struct SurfacePermissionToken(String);

impl SurfacePermissionToken {
    /// Borrow the encoded JWT.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume the token wrapper.
    pub fn into_inner(self) -> String {
        self.0
    }
}

/// Sign a surface grant with HS256, without changing legacy document encoding.
pub fn encode_surface(
    claims: &SurfaceClaims,
    secret: &str,
) -> Result<SurfacePermissionToken, jsonwebtoken::errors::Error> {
    let token = jwt_encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;
    Ok(SurfacePermissionToken(token))
}

/// Verify a surface grant's signature, issuer, expiry, kind, and scoped ID.
///
/// Unlike the legacy decoder, this has no expiry leeway. Route target matching,
/// access-level enforcement, lifecycle checks, and socket expiry enforcement
/// remain the caller's responsibility.
pub fn decode_surface(
    token: &str,
    secret: &str,
) -> Result<SurfaceClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[ISSUER]);
    validation.leeway = 0;
    let data = jwt_decode::<SurfaceClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

#[cfg(test)]
mod test;
