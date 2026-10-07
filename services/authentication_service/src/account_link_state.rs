//! Signed, expiring OAuth `state` for account-link flows.
//!
//! `/link/gmail`, `/link/github`, and `/link/outlook` send the browser to a
//! provider's consent screen with a `state` parameter that comes back, as
//! sent, to `/oauth2/{provider}/callback`. The callback uses it to find the
//! pending `in_progress_user_link` row and to decide where to redirect, so a
//! forged `state` could point another user's consent at an attacker's pending
//! link or redirect the browser elsewhere. The state is therefore signed, and
//! the callback refuses anything it cannot verify.
//!
//! The token is `base64url(payload).base64url(signature)`, without padding,
//! where the signature is HMAC-SHA256 over the encoded payload. This mirrors
//! the GitHub App installation state in the `github` crate.

use std::sync::Arc;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;
use zeroize::Zeroizing;

#[cfg(test)]
mod test;

type HmacSha256 = Hmac<Sha256>;

/// How long a signed state stays valid. Consent takes minutes, and a pending
/// link is only kept for a day, so an hour leaves room for a slow user without
/// letting a leaked authorization URL stay live indefinitely.
pub(crate) const ACCOUNT_LINK_STATE_TTL: chrono::Duration = chrono::Duration::hours(1);

/// HMAC-SHA256 keys shorter than the digest weaken the construction (RFC 2104
/// recommends at least the output length).
const MIN_SECRET_LENGTH: usize = 32;

/// The callback a state was issued for. The same path segment the callback
/// router receives, so a state issued for one provider cannot complete
/// another's callback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LinkProvider {
    /// Gmail (and Google Calendar) linking.
    Google,
    /// GitHub account linking.
    Github,
    /// Microsoft Outlook linking.
    Microsoft,
}

impl LinkProvider {
    /// The `{provider}` segment of `/oauth2/{provider}/callback`.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Github => "github",
            Self::Microsoft => "microsoft",
        }
    }
}

impl std::fmt::Display for LinkProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Authenticated context carried through an account-link OAuth flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AccountLinkState {
    /// Which callback may complete this state.
    pub provider: LinkProvider,
    /// The FusionAuth identity provider that will hold the resulting grant.
    pub identity_provider_id: String,
    /// The pending `in_progress_user_link` row this consent completes.
    pub link_id: Uuid,
    /// The FusionAuth user who began the link. The callback refuses to
    /// complete a link whose pending row belongs to anyone else.
    pub fusion_user_id: Uuid,
    /// Where to send the browser once the link completes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_url: Option<String>,
    /// Expiration time in Unix seconds.
    pub exp: i64,
}

impl AccountLinkState {
    /// A state for a link that `fusion_user_id` just began, expiring
    /// [`ACCOUNT_LINK_STATE_TTL`] from now.
    pub(crate) fn new(
        provider: LinkProvider,
        identity_provider_id: String,
        link_id: Uuid,
        fusion_user_id: Uuid,
        original_url: Option<String>,
    ) -> Self {
        Self {
            provider,
            identity_provider_id,
            link_id,
            fusion_user_id,
            original_url,
            exp: (chrono::Utc::now() + ACCOUNT_LINK_STATE_TTL).timestamp(),
        }
    }
}

/// An error encountered while signing or verifying account-link state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub(crate) enum AccountLinkStateError {
    /// The payload could not be serialized.
    #[error("account-link state payload could not be serialized")]
    Serialization,
    /// The token does not have the expected encoding or payload shape.
    #[error("account-link state token is malformed")]
    Malformed,
    /// The token's signature is invalid.
    #[error("account-link state signature is invalid")]
    InvalidSignature,
    /// The token is authentic but has reached its expiration time. Carries
    /// the pending link it named so the caller can release that row.
    #[error("account-link state token has expired")]
    Expired {
        /// The pending link the expired state was issued for.
        link_id: Uuid,
    },
}

/// The HMAC key that signs account-link state. Never printed.
#[derive(Clone)]
pub(crate) struct AccountLinkStateKey(Arc<Zeroizing<Vec<u8>>>);

impl AccountLinkStateKey {
    /// Wraps the configured secret.
    ///
    /// # Errors
    /// If the secret is blank or shorter than 32 bytes. A short key is a
    /// configuration mistake the service should refuse at startup.
    pub(crate) fn new(secret: &str) -> anyhow::Result<Self> {
        let secret = secret.trim();
        if secret.len() < MIN_SECRET_LENGTH {
            anyhow::bail!(
                "ACCOUNT_LINK_STATE_SECRET must be at least {MIN_SECRET_LENGTH} bytes of random data"
            );
        }
        Ok(Self(Arc::new(Zeroizing::new(secret.as_bytes().to_vec()))))
    }

    fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl std::fmt::Debug for AccountLinkStateKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AccountLinkStateKey(<redacted>)")
    }
}

/// Serialize and sign an account-link state.
pub(crate) fn sign_account_link_state(
    state: &AccountLinkState,
    key: &AccountLinkStateKey,
) -> Result<String, AccountLinkStateError> {
    let json = serde_json::to_vec(state).map_err(|_| AccountLinkStateError::Serialization)?;
    let encoded_payload = URL_SAFE_NO_PAD.encode(json);
    let signature = signature_for(encoded_payload.as_bytes(), key);

    Ok(format!(
        "{encoded_payload}.{}",
        URL_SAFE_NO_PAD.encode(signature)
    ))
}

/// Verify and deserialize an account-link state token.
///
/// `current_timestamp` is expressed in Unix seconds. A token is expired when
/// the current timestamp is equal to or later than its `exp` value. The
/// signature is checked before the payload is decoded, so nothing in a
/// rejected token is ever interpreted.
pub(crate) fn verify_account_link_state(
    token: &str,
    key: &AccountLinkStateKey,
    current_timestamp: i64,
) -> Result<AccountLinkState, AccountLinkStateError> {
    let (encoded_payload, encoded_signature) = split_token(token)?;
    let signature = URL_SAFE_NO_PAD
        .decode(encoded_signature)
        .map_err(|_| AccountLinkStateError::Malformed)?;

    let mut verifier =
        HmacSha256::new_from_slice(key.as_bytes()).expect("HMAC-SHA256 accepts keys of any length");
    verifier.update(encoded_payload.as_bytes());
    verifier
        .verify_slice(&signature)
        .map_err(|_| AccountLinkStateError::InvalidSignature)?;

    let json = URL_SAFE_NO_PAD
        .decode(encoded_payload)
        .map_err(|_| AccountLinkStateError::Malformed)?;
    let state: AccountLinkState =
        serde_json::from_slice(&json).map_err(|_| AccountLinkStateError::Malformed)?;

    if current_timestamp >= state.exp {
        return Err(AccountLinkStateError::Expired {
            link_id: state.link_id,
        });
    }

    Ok(state)
}

fn split_token(token: &str) -> Result<(&str, &str), AccountLinkStateError> {
    let mut segments = token.split('.');
    let payload = segments.next().filter(|segment| !segment.is_empty());
    let signature = segments.next().filter(|segment| !segment.is_empty());

    match (payload, signature, segments.next()) {
        (Some(payload), Some(signature), None) => Ok((payload, signature)),
        _ => Err(AccountLinkStateError::Malformed),
    }
}

fn signature_for(payload: &[u8], key: &AccountLinkStateKey) -> [u8; 32] {
    let mut signer =
        HmacSha256::new_from_slice(key.as_bytes()).expect("HMAC-SHA256 accepts keys of any length");
    signer.update(payload);
    signer.finalize().into_bytes().into()
}
