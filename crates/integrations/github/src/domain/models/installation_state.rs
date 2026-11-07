//! Signed state carried through a GitHub App installation flow.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

#[cfg(test)]
mod test;

type HmacSha256 = Hmac<Sha256>;

/// Authenticated context for a GitHub App installation flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallationState {
    /// The Macro user who began the installation flow.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The team to associate with the installation, or `None` for a personal installation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<Uuid>,
    /// The token expiration time in Unix seconds.
    pub exp: i64,
}

/// An error encountered while signing or verifying installation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InstallationStateError {
    /// The payload could not be serialized.
    #[error("installation state payload could not be serialized")]
    Serialization,
    /// The token does not have the expected encoding or payload shape.
    #[error("installation state token is malformed")]
    Malformed,
    /// The token's signature is invalid.
    #[error("installation state signature is invalid")]
    InvalidSignature,
    /// The token has reached its expiration time.
    #[error("installation state token has expired")]
    Expired,
}

/// Serialize and sign an installation-state payload.
///
/// The returned token is `base64url(payload).base64url(signature)`, without
/// padding. The signature is HMAC-SHA256 over the encoded payload.
pub fn sign_installation_state(
    payload: &InstallationState,
    secret: &[u8],
) -> Result<String, InstallationStateError> {
    let json = serde_json::to_vec(payload).map_err(|_| InstallationStateError::Serialization)?;
    let encoded_payload = URL_SAFE_NO_PAD.encode(json);
    let signature = signature_for(encoded_payload.as_bytes(), secret);

    Ok(format!(
        "{encoded_payload}.{}",
        URL_SAFE_NO_PAD.encode(signature)
    ))
}

/// Verify and deserialize an installation-state token.
///
/// `current_timestamp` is expressed in Unix seconds. A token is expired when
/// the current timestamp is equal to or later than its `exp` value.
pub fn verify_installation_state(
    token: &str,
    secret: &[u8],
    current_timestamp: i64,
) -> Result<InstallationState, InstallationStateError> {
    let (encoded_payload, encoded_signature) = split_token(token)?;
    let signature = URL_SAFE_NO_PAD
        .decode(encoded_signature)
        .map_err(|_| InstallationStateError::Malformed)?;

    let mut verifier =
        HmacSha256::new_from_slice(secret).expect("HMAC-SHA256 accepts keys of any length");
    verifier.update(encoded_payload.as_bytes());
    verifier
        .verify_slice(&signature)
        .map_err(|_| InstallationStateError::InvalidSignature)?;

    let json = URL_SAFE_NO_PAD
        .decode(encoded_payload)
        .map_err(|_| InstallationStateError::Malformed)?;
    let payload: InstallationState =
        serde_json::from_slice(&json).map_err(|_| InstallationStateError::Malformed)?;

    if current_timestamp >= payload.exp {
        return Err(InstallationStateError::Expired);
    }

    Ok(payload)
}

fn split_token(token: &str) -> Result<(&str, &str), InstallationStateError> {
    let mut segments = token.split('.');
    let payload = segments.next().filter(|segment| !segment.is_empty());
    let signature = segments.next().filter(|segment| !segment.is_empty());

    match (payload, signature, segments.next()) {
        (Some(payload), Some(signature), None) => Ok((payload, signature)),
        _ => Err(InstallationStateError::Malformed),
    }
}

fn signature_for(payload: &[u8], secret: &[u8]) -> [u8; 32] {
    let mut signer =
        HmacSha256::new_from_slice(secret).expect("HMAC-SHA256 accepts keys of any length");
    signer.update(payload);
    signer.finalize().into_bytes().into()
}
