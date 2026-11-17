//! The secret that ties one OAuth handshake to the browser that started it.

#[cfg(test)]
mod test;

use std::fmt;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// Random bytes in a binding secret.
const SECRET_LEN: usize = 32;
/// Domain separator for the digest stored with a pending authorization.
const PENDING_DIGEST_PREFIX: &[u8] = b"mcp-oauth-browser-binding:";
/// Domain separator for the token embedded in the broker's forms.
const FORM_TOKEN_PREFIX: &[u8] = b"mcp-oauth-consent:";

/// A random secret held in a cookie by the browser that started an
/// authorization.
///
/// `/authorize` stores its digest with the pending authorization and the
/// upstream callback must present the same cookie, so a sign-in link started
/// by someone else cannot be completed in a victim's browser. The broker's forms
/// carry a token derived from it, so a cross-site form post cannot approve a
/// client or submit a sign-in on the user's behalf.
#[derive(Clone, Eq, PartialEq)]
pub struct BrowserBinding(String);

impl BrowserBinding {
    /// Generates a fresh secret.
    pub fn generate() -> Self {
        let secret: [u8; SECRET_LEN] = rand::random();
        Self(URL_SAFE_NO_PAD.encode(secret))
    }

    /// Parses a secret presented by a browser, refusing anything that is not
    /// the shape `generate` produces.
    pub fn parse(value: &str) -> Option<Self> {
        let decoded = URL_SAFE_NO_PAD.decode(value).ok()?;
        (decoded.len() == SECRET_LEN).then(|| Self(value.to_owned()))
    }

    /// The secret, for the cookie that carries it.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The digest stored with a pending authorization, so the store never
    /// holds the secret itself.
    pub fn digest(&self) -> String {
        self.derive(PENDING_DIGEST_PREFIX)
    }

    /// Returns whether `digest` was taken from this secret, in constant time.
    pub fn matches_digest(&self, digest: &str) -> bool {
        self.digest().as_bytes().ct_eq(digest.as_bytes()).into()
    }

    /// The anti-forgery token the broker's forms carry.
    pub fn form_token(&self) -> String {
        self.derive(FORM_TOKEN_PREFIX)
    }

    /// Returns whether `token` is this secret's form token, in constant time.
    pub fn accepts_form_token(&self, token: &str) -> bool {
        self.form_token().as_bytes().ct_eq(token.as_bytes()).into()
    }

    fn derive(&self, prefix: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(prefix);
        hasher.update(self.0.as_bytes());
        URL_SAFE_NO_PAD.encode(hasher.finalize())
    }
}

impl fmt::Debug for BrowserBinding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BrowserBinding([REDACTED])")
    }
}
