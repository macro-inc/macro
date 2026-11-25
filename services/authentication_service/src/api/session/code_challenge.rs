//! Binds a session code to the app that will redeem it, the way PKCE (RFC
//! 7636, method `S256`) binds an OAuth code. The app keeps a random verifier
//! and sends only its challenge, `BASE64URL(SHA-256(verifier))`, to the page
//! that mints the code. The code then redeems only with the verifier, so a
//! code read off a `macro://` link by another app is useless to it.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

/// The length of a base64url SHA-256 digest without padding.
const CHALLENGE_LENGTH: usize = 43;

/// RFC 7636's bounds on a verifier's length.
const VERIFIER_LENGTHS: std::ops::RangeInclusive<usize> = 43..=128;

/// The challenge a session code is bound to: a base64url SHA-256 digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::api) struct CodeChallenge(String);

/// The secret the redeeming app holds. `Debug` never shows it.
pub(in crate::api) struct CodeVerifier(String);

#[derive(Debug, thiserror::Error)]
pub(in crate::api) enum CodeChallengeError {
    #[error("challenge must be a base64url SHA-256 digest without padding")]
    Challenge,
    #[error("verifier must be 43 to 128 unreserved characters")]
    Verifier,
}

impl CodeChallenge {
    pub(in crate::api) fn parse(value: &str) -> Result<Self, CodeChallengeError> {
        let is_digest = value.len() == CHALLENGE_LENGTH
            && URL_SAFE_NO_PAD
                .decode(value)
                .is_ok_and(|bytes| bytes.len() == Sha256::output_size());
        if !is_digest {
            return Err(CodeChallengeError::Challenge);
        }
        Ok(Self(value.to_owned()))
    }

    pub(in crate::api) fn of(verifier: &CodeVerifier) -> Self {
        Self(URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.0.as_bytes())))
    }

    pub(in crate::api) fn as_str(&self) -> &str {
        &self.0
    }
}

impl CodeVerifier {
    pub(in crate::api) fn parse(value: String) -> Result<Self, CodeChallengeError> {
        let unreserved = value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte));
        if !VERIFIER_LENGTHS.contains(&value.len()) || !unreserved {
            return Err(CodeChallengeError::Verifier);
        }
        Ok(Self(value))
    }
}

impl std::fmt::Debug for CodeVerifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CodeVerifier(..)")
    }
}
