//! Which credential a request carries, read once from every place one can
//! travel and shared by everything that authenticates or scopes the request.
//!
//! Authentication and the agent scope check must see the same credential, or
//! a request can be authenticated as one and scoped as another. Both read it
//! through [`request_credential`], which parses the request once and keeps the
//! answer in its extensions. A request that carries more than one credential,
//! unless they are the same token repeated, is refused.

#[cfg(test)]
mod test;

use std::sync::LazyLock;

use axum::http::{HeaderMap, header, request::Parts};
use macro_env::Environment;

use crate::constant::MACRO_ACCESS_TOKEN_COOKIE;

/// The query parameter a user token may travel in.
pub const USER_TOKEN_QUERY_KEY: &str = "macro-api-token";
/// The header a user's API key travels in.
pub const USER_API_KEY_HEADER: &str = "x-macro-user-api-key";
/// The header a bot token travels in.
pub const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
/// The header a harness token travels in.
pub const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";
/// The header the internal API key travels in.
pub const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";
/// The document storage service's older header for the internal API key.
pub const LEGACY_DSS_INTERNAL_API_KEY_HEADER: &str = "x-document-storage-service-auth-key";

/// The access-token cookie's name in this environment.
pub fn access_token_cookie_name() -> &'static str {
    static NAME: LazyLock<String> = LazyLock::new(|| match Environment::new_or_prod() {
        Environment::Production => MACRO_ACCESS_TOKEN_COOKIE.to_string(),
        Environment::Develop => format!("dev-{MACRO_ACCESS_TOKEN_COOKIE}"),
        Environment::Local => format!("local-{MACRO_ACCESS_TOKEN_COOKIE}"),
    });
    &NAME
}

/// The one credential a request carries.
#[derive(Clone, PartialEq, Eq)]
pub enum RequestCredential {
    /// No credential.
    None,
    /// A user's JWT (a session or a Macro API token), from a bearer header, a
    /// `macro-api-token` query parameter or the access-token cookie.
    UserToken {
        /// The token.
        token: String,
        /// Sent as a bearer or query parameter, not only as the ambient
        /// cookie.
        explicit: bool,
    },
    /// An `Authorization` header that is not a bearer token.
    MalformedAuthorization,
    /// A user API key; its header is read by its authorizer.
    UserApiKey,
    /// A bot token; its headers are read by its authorizer.
    Bot,
    /// A harness token; its headers are read by its authorizer.
    Harness,
    /// The internal API key, under either header; read by its authorizer.
    Internal,
}

impl std::fmt::Debug for RequestCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => formatter.write_str("None"),
            Self::UserToken { explicit, .. } => formatter
                .debug_struct("UserToken")
                .field("explicit", explicit)
                .finish_non_exhaustive(),
            Self::MalformedAuthorization => formatter.write_str("MalformedAuthorization"),
            Self::UserApiKey => formatter.write_str("UserApiKey"),
            Self::Bot => formatter.write_str("Bot"),
            Self::Harness => formatter.write_str("Harness"),
            Self::Internal => formatter.write_str("Internal"),
        }
    }
}

/// The request carries more than one credential that differ: answered 400
/// `conflicting_credentials`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("conflicting_credentials")]
pub struct ConflictingCredentials;

#[derive(Clone)]
struct Parsed(Result<RequestCredential, ConflictingCredentials>);

/// The credential `parts` carries, parsed on the first call and kept in the
/// request's extensions for every later one.
pub fn request_credential(parts: &mut Parts) -> Result<RequestCredential, ConflictingCredentials> {
    if let Some(Parsed(parsed)) = parts.extensions.get::<Parsed>() {
        return parsed.clone();
    }
    let parsed = parse(&parts.headers, parts.uri.query());
    parts.extensions.insert(Parsed(parsed.clone()));
    parsed
}

/// Every candidate from every source: each bearer, each query parameter
/// whose decoded key is [`USER_TOKEN_QUERY_KEY`] (repeats included), each
/// access-token cookie, and each other credential header.
fn parse(
    headers: &HeaderMap,
    query: Option<&str>,
) -> Result<RequestCredential, ConflictingCredentials> {
    let mut tokens: Vec<String> = Vec::new();
    let mut explicit = false;
    let mut malformed = false;
    for value in headers.get_all(header::AUTHORIZATION) {
        explicit = true;
        match value.to_str().ok().and_then(bearer) {
            Some(token) => tokens.push(token.to_owned()),
            None => malformed = true,
        }
    }
    if let Some(query) = query {
        let pairs: Vec<(String, String)> = serde_urlencoded::from_str(query).unwrap_or_default();
        for (key, value) in pairs {
            if key == USER_TOKEN_QUERY_KEY {
                explicit = true;
                tokens.push(value);
            }
        }
    }
    for value in headers.get_all(header::COOKIE) {
        let Ok(value) = value.to_str() else {
            continue;
        };
        for cookie in cookie::Cookie::split_parse(value).flatten() {
            if cookie.name() == access_token_cookie_name() {
                tokens.push(cookie.value_trimmed().to_owned());
            }
        }
    }
    tokens.sort();
    tokens.dedup();

    let mut kinds = Vec::new();
    if malformed {
        kinds.push(RequestCredential::MalformedAuthorization);
    }
    match tokens.as_slice() {
        [] => {}
        [token] => kinds.push(RequestCredential::UserToken {
            token: token.clone(),
            explicit,
        }),
        _ => return Err(ConflictingCredentials),
    }
    for (names, kind) in [
        (&[USER_API_KEY_HEADER][..], RequestCredential::UserApiKey),
        (&[BOT_TOKEN_HEADER][..], RequestCredential::Bot),
        (&[HARNESS_TOKEN_HEADER][..], RequestCredential::Harness),
        (
            &[INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_API_KEY_HEADER][..],
            RequestCredential::Internal,
        ),
    ] {
        let mut values = names
            .iter()
            .flat_map(|name| headers.get_all(*name))
            .map(|value| value.as_bytes())
            .collect::<Vec<_>>();
        values.sort();
        values.dedup();
        match values.len() {
            0 => {}
            1 => kinds.push(kind),
            _ => return Err(ConflictingCredentials),
        }
    }
    match kinds.len() {
        0 => Ok(RequestCredential::None),
        1 => Ok(kinds.remove(0)),
        _ => Err(ConflictingCredentials),
    }
}

/// The token of an `Authorization: Bearer` value, its scheme in any case.
fn bearer(value: &str) -> Option<&str> {
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}
