//! Session credentials: the web client's `xoxc-` token and its `d` cookie.

use std::fmt;

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// A credential value that failed its shape check. Never carries the value.
#[derive(Debug, thiserror::Error)]
pub enum InvalidCredential {
    /// The token is not an `xoxc-` (or legacy `xoxs-`) user session token.
    #[error("session token must start with xoxc- or xoxs-")]
    Token,
    /// The `d` cookie is not an `xoxd-` value.
    #[error("d cookie must be an xoxd- value")]
    Cookie,
}

/// A secret string: zeroized on drop, redacted in `Debug`, serialized as is
/// (callers seal it before storing).
#[derive(Clone, PartialEq, Eq, Zeroize, ZeroizeOnDrop, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// Wraps a secret value.
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// The plaintext, for putting on the wire. Never log it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Secret(<redacted>)")
    }
}

/// The web client's user session token (`xoxc-…`).
#[derive(Clone, PartialEq, Eq, Zeroize, ZeroizeOnDrop, Serialize, Deserialize)]
#[serde(try_from = "Secret", into = "Secret")]
pub struct SessionToken(Secret);

impl SessionToken {
    /// Validates a session token.
    pub fn new(value: String) -> Result<Self, InvalidCredential> {
        let value = Secret::new(value);
        if lazy_regex::regex_is_match!(r"^xox[cs]-[A-Za-z0-9-]+$", value.expose()) {
            Ok(Self(value))
        } else {
            Err(InvalidCredential::Token)
        }
    }

    /// The plaintext token. Never log it.
    pub fn expose(&self) -> &str {
        self.0.expose()
    }
}

impl TryFrom<Secret> for SessionToken {
    type Error = InvalidCredential;

    fn try_from(value: Secret) -> Result<Self, Self::Error> {
        Self::new(value.expose().to_owned())
    }
}

impl From<SessionToken> for Secret {
    fn from(value: SessionToken) -> Secret {
        value.0.clone()
    }
}

impl fmt::Debug for SessionToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionToken(<redacted>)")
    }
}

/// The `d` cookie (`xoxd-…`) that binds a session token to the browser
/// session. Held decoded; percent-encoded only on the wire.
#[derive(Clone, PartialEq, Eq, Zeroize, ZeroizeOnDrop, Serialize, Deserialize)]
#[serde(try_from = "Secret", into = "Secret")]
pub struct CookieToken(Secret);

impl CookieToken {
    /// Validates a `d` cookie, accepting the browser's percent-encoded form.
    pub fn new(mut value: String) -> Result<Self, InvalidCredential> {
        let decoded = urlencoding::decode(&value).map(|decoded| Secret::new(decoded.into_owned()));
        value.zeroize();
        let decoded = decoded.map_err(|_| InvalidCredential::Cookie)?;
        if lazy_regex::regex_is_match!(r"^xoxd-[A-Za-z0-9/+=_-]+$", decoded.expose()) {
            Ok(Self(decoded))
        } else {
            Err(InvalidCredential::Cookie)
        }
    }

    /// The decoded cookie value. Never log it.
    pub fn expose(&self) -> &str {
        self.0.expose()
    }
}

impl TryFrom<Secret> for CookieToken {
    type Error = InvalidCredential;

    fn try_from(value: Secret) -> Result<Self, Self::Error> {
        Self::new(value.expose().to_owned())
    }
}

impl From<CookieToken> for Secret {
    fn from(value: CookieToken) -> Secret {
        value.0.clone()
    }
}

impl fmt::Debug for CookieToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CookieToken(<redacted>)")
    }
}

/// Everything needed to act as the user in one workspace's web client.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct SessionCredentials {
    /// The `xoxc-` token, sent as the `token` form field.
    pub token: SessionToken,
    /// The `d` cookie.
    pub cookie: CookieToken,
    /// The `d-s` cookie (a session start timestamp) when the browser had one.
    pub cookie_session_start: Option<Secret>,
}

impl SessionCredentials {
    /// The `Cookie` header value the web client sends.
    pub(crate) fn cookie_header(&self) -> Secret {
        let mut header = format!("d={}", urlencoding::encode(self.cookie.expose()));
        if let Some(start) = &self.cookie_session_start {
            header.push_str("; d-s=");
            header.push_str(start.expose());
        }
        Secret::new(header)
    }
}
