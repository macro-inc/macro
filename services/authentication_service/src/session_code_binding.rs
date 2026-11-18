//! Binds an SSO sign-in's session code to the sign-in attempt that asked for
//! it, the PKCE way (RFC 7636, S256 only).
//!
//! A client that gets its session code back in a URL (the desktop app's
//! `macro:///login` deep link, the dev-proxy handoff) learns the code from
//! whatever opens that URL, and so can anything else that reads it. So the
//! client sends `/login/sso` the S256 challenge of a random verifier it keeps
//! to itself; the challenge rides the OAuth state to `/oauth/redirect`, which
//! stores it with the code; and `/session/login/{code}` redeems a code stored
//! with a challenge only for the verifier that answers it, sent in the
//! [`SESSION_CODE_VERIFIER_HEADER`] header. A client that sends a verifier
//! binds every sign-in, so a code without a challenge is refused to it.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

/// A SHA-256 digest is 32 bytes: 43 characters of unpadded base64url.
const CHALLENGE_LENGTH: usize = 43;
const DIGEST_BYTES: usize = 32;
/// RFC 7636 section 4.1: a verifier is 43 to 128 characters.
const VERIFIER_LENGTH: std::ops::RangeInclusive<usize> = 43..=128;

/// Why a challenge or verifier was refused.
#[derive(Debug, thiserror::Error)]
pub(crate) enum InvalidBinding {
    #[error("session_code_challenge must be an unpadded base64url SHA-256 digest")]
    Challenge,
    #[error("code_verifier must be 43 to 128 characters of A-Z, a-z, 0-9, '-', '.', '_' or '~'")]
    Verifier,
}

/// The S256 challenge a session code is bound to:
/// `base64url(sha256(verifier))`, without padding. It travels in URLs, so it
/// is no secret.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub(crate) struct SessionCodeChallenge(String);

impl SessionCodeChallenge {
    /// The challenge `verifier` answers.
    pub(crate) fn of(verifier: &SessionCodeVerifier) -> Self {
        Self(URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.0.as_bytes())))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for SessionCodeChallenge {
    type Error = InvalidBinding;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() != CHALLENGE_LENGTH {
            return Err(InvalidBinding::Challenge);
        }
        match URL_SAFE_NO_PAD.decode(&value) {
            Ok(digest) if digest.len() == DIGEST_BYTES => Ok(Self(value)),
            _ => Err(InvalidBinding::Challenge),
        }
    }
}

impl From<SessionCodeChallenge> for String {
    fn from(challenge: SessionCodeChallenge) -> Self {
        challenge.0
    }
}

/// The request header a redemption sends its verifier in. Not the query:
/// load balancer access logs keep the whole URL.
pub(crate) const SESSION_CODE_VERIFIER_HEADER: &str = "x-session-code-verifier";

/// What a redemption request sent in [`SESSION_CODE_VERIFIER_HEADER`].
#[derive(Debug)]
pub(crate) enum SentVerifier {
    /// Nothing: a client that predates binding.
    Absent,
    /// A value that is no verifier, so it answers no challenge.
    Malformed,
    Valid(SessionCodeVerifier),
}

impl SentVerifier {
    pub(crate) fn from_header(value: Option<&axum::http::HeaderValue>) -> Self {
        let Some(value) = value else {
            return Self::Absent;
        };
        value
            .to_str()
            .ok()
            .and_then(|value| SessionCodeVerifier::try_from(value.to_owned()).ok())
            .map_or(Self::Malformed, Self::Valid)
    }

    /// Whether this answers `challenge`, as stored with a code.
    pub(crate) fn answers(&self, challenge: &str) -> bool {
        matches!(self, Self::Valid(verifier) if verifier.answers(challenge))
    }

    /// For span fields: what was sent, never the value.
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Absent => "absent",
            Self::Malformed => "malformed",
            Self::Valid(_) => "valid",
        }
    }
}

/// The secret a sign-in attempt keeps and sends only to redeem its session
/// code. `Debug` never prints it.
#[derive(Clone)]
pub(crate) struct SessionCodeVerifier(String);

impl SessionCodeVerifier {
    /// Whether this verifier answers `challenge`, as stored with a code.
    pub(crate) fn answers(&self, challenge: &str) -> bool {
        SessionCodeChallenge::of(self).as_str() == challenge
    }
}

impl TryFrom<String> for SessionCodeVerifier {
    type Error = InvalidBinding;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let unreserved = |byte: u8| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte);
        if VERIFIER_LENGTH.contains(&value.len()) && value.bytes().all(unreserved) {
            Ok(Self(value))
        } else {
            Err(InvalidBinding::Verifier)
        }
    }
}

impl std::fmt::Debug for SessionCodeVerifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SessionCodeVerifier(<redacted>)")
    }
}
