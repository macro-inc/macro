//! Which credential a request carries, read once from every place one can
//! travel and shared by everything that authenticates or scopes the request.
//!
//! Authentication and the agent scope check must see the same credential, or
//! a request can be authenticated as one and scoped as another. Both read it
//! through [`request_credential`], which parses the request once and keeps the
//! answer in its extensions. It names the credential the request
//! authenticates with (a user token by fixed precedence: query parameter,
//! bearer, cookie) and every user token the request carries, so the scope
//! check can hold the request to the narrowest scope any of them signs.
//! Explicit credentials of different kinds are refused, as before; browsers
//! and native apps send their cookie beside other credentials, so a cookie
//! never conflicts by itself.

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

/// Where a user token was found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenSource {
    /// A `macro-api-token` query parameter.
    Query,
    /// An `Authorization: Bearer` header.
    Bearer,
    /// The access-token cookie, sent ambiently by browsers and native apps.
    Cookie,
}

/// The credential a request authenticates with.
#[derive(Clone, PartialEq, Eq)]
pub enum CredentialKind {
    /// No credential.
    None,
    /// A user token (a session or a Macro API token, or something else in
    /// a bearer that the route reads itself), the first of query parameter,
    /// bearer and cookie.
    UserToken {
        /// The token.
        token: String,
        /// Where it was found.
        source: TokenSource,
    },
    /// An `Authorization` header that is not a bearer token, and no query
    /// token.
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

/// What a request carries: the credential it authenticates with, and every
/// user token in it, wherever it was found, so a scope any of them signs
/// can't be stepped around by sending another beside it.
#[derive(Clone, PartialEq, Eq)]
pub struct RequestCredential {
    /// The credential the request authenticates with.
    pub kind: CredentialKind,
    /// Every distinct user token the request carries, from every source,
    /// the authenticating one included.
    pub user_tokens: Vec<String>,
}

impl std::fmt::Debug for CredentialKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => formatter.write_str("None"),
            Self::UserToken { source, .. } => formatter
                .debug_struct("UserToken")
                .field("source", source)
                .finish_non_exhaustive(),
            Self::MalformedAuthorization => formatter.write_str("MalformedAuthorization"),
            Self::UserApiKey => formatter.write_str("UserApiKey"),
            Self::Bot => formatter.write_str("Bot"),
            Self::Harness => formatter.write_str("Harness"),
            Self::Internal => formatter.write_str("Internal"),
        }
    }
}

impl std::fmt::Debug for RequestCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RequestCredential")
            .field("kind", &self.kind)
            .field("user_tokens", &self.user_tokens.len())
            .finish()
    }
}

/// Why a request's credential can't be told: answered 400 with its name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CredentialError {
    /// Explicit credentials of different kinds, or one credential header
    /// with different values.
    #[error("conflicting_credentials")]
    Conflicting,
    /// A query string that can't be read as form pairs, so whether it
    /// carries a token can't be told.
    #[error("unreadable_query")]
    UnreadableQuery,
}

impl CredentialError {
    /// The error code a response names.
    pub fn code(self) -> &'static str {
        match self {
            Self::Conflicting => "conflicting_credentials",
            Self::UnreadableQuery => "unreadable_query",
        }
    }
}

/// The bearer and access-token cookie a request carries, read from the same
/// parse as [`request_credential`], for the extractors that have always
/// read only those two: the first bearer, else the last cookie, as cookie
/// jars keep it, whatever else the request carries.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct AccessTokenSources {
    /// The first `Authorization: Bearer` token.
    pub bearer: Option<String>,
    /// The last access-token cookie.
    pub cookie: Option<String>,
}

impl std::fmt::Debug for AccessTokenSources {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AccessTokenSources")
            .field("bearer", &self.bearer.is_some())
            .field("cookie", &self.cookie.is_some())
            .finish()
    }
}

#[derive(Clone)]
struct Parsed {
    credential: Result<RequestCredential, CredentialError>,
    sources: AccessTokenSources,
}

fn parsed(parts: &mut Parts) -> Parsed {
    if let Some(parsed) = parts.extensions.get::<Parsed>() {
        return parsed.clone();
    }
    let parsed = parse(&parts.headers, parts.uri.query());
    parts.extensions.insert(parsed.clone());
    parsed
}

/// The credential `parts` carries, parsed on the first call and kept in the
/// request's extensions for every later one.
pub fn request_credential(parts: &mut Parts) -> Result<RequestCredential, CredentialError> {
    parsed(parts).credential
}

/// The bearer and access-token cookie `parts` carries; see
/// [`AccessTokenSources`].
pub fn access_token_sources(parts: &mut Parts) -> AccessTokenSources {
    parsed(parts).sources
}

/// Every candidate from every source: each query parameter whose decoded key
/// is [`USER_TOKEN_QUERY_KEY`] (repeats included), each bearer, each
/// access-token cookie (names and values percent-decoded, as cookie jars
/// read them), and each other credential header.
fn parse(headers: &HeaderMap, query: Option<&str>) -> Parsed {
    let mut bearers: Vec<String> = Vec::new();
    let mut malformed = false;
    for value in headers.get_all(header::AUTHORIZATION) {
        match value.to_str().ok().and_then(bearer) {
            Some(token) => bearers.push(token.to_owned()),
            None => malformed = true,
        }
    }
    let mut cookies: Vec<String> = Vec::new();
    for value in headers.get_all(header::COOKIE) {
        let Ok(value) = value.to_str() else {
            continue;
        };
        for cookie in cookie::Cookie::split_parse_encoded(value).flatten() {
            if cookie.name() == access_token_cookie_name() {
                cookies.push(cookie.value_trimmed().to_owned());
            }
        }
    }
    let sources = AccessTokenSources {
        bearer: bearers.first().cloned(),
        cookie: cookies.last().cloned(),
    };
    let credential = credential(headers, query, bearers, malformed, cookies);
    Parsed {
        credential,
        sources,
    }
}

/// The credential from every source, the bearers and cookies already read.
fn credential(
    headers: &HeaderMap,
    query: Option<&str>,
    bearers: Vec<String>,
    malformed: bool,
    cookies: Vec<String>,
) -> Result<RequestCredential, CredentialError> {
    let mut found: Vec<(String, TokenSource)> = Vec::new();
    if let Some(query) = query {
        let pairs: Vec<(String, String)> =
            serde_urlencoded::from_str(query).map_err(|_| CredentialError::UnreadableQuery)?;
        for (key, value) in pairs {
            if key == USER_TOKEN_QUERY_KEY {
                found.push((value, TokenSource::Query));
            }
        }
    }
    found.extend(
        bearers
            .into_iter()
            .map(|token| (token, TokenSource::Bearer)),
    );
    found.extend(
        cookies
            .into_iter()
            .map(|token| (token, TokenSource::Cookie)),
    );
    let mut user_tokens: Vec<String> = found.iter().map(|(token, _)| token.clone()).collect();
    user_tokens.sort();
    user_tokens.dedup();
    // The first query token, else the first bearer, else the last cookie,
    // which is the one cookie jars keep when a name repeats (a host-only
    // cookie beside a domain-wide one).
    let explicit = found
        .iter()
        .find(|(_, source)| *source != TokenSource::Cookie)
        .cloned();
    let user = match explicit {
        Some((token, source)) => Some(CredentialKind::UserToken { token, source }),
        None if malformed => Some(CredentialKind::MalformedAuthorization),
        None => found
            .last()
            .map(|(token, source)| CredentialKind::UserToken {
                token: token.clone(),
                source: *source,
            }),
    };
    let ambient_user = matches!(
        &user,
        Some(CredentialKind::UserToken {
            source: TokenSource::Cookie,
            ..
        })
    );

    let mut kinds = Vec::new();
    for (names, kind) in [
        (&[USER_API_KEY_HEADER][..], CredentialKind::UserApiKey),
        (&[BOT_TOKEN_HEADER][..], CredentialKind::Bot),
        (&[HARNESS_TOKEN_HEADER][..], CredentialKind::Harness),
        (
            &[INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_API_KEY_HEADER][..],
            CredentialKind::Internal,
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
            _ => return Err(CredentialError::Conflicting),
        }
    }
    // An ambient cookie never competes with an explicit credential of
    // another kind: the explicit one authenticates, and the cookie's token
    // is still in `user_tokens` for the scope check.
    let kind = match (user, kinds.len()) {
        (None, 0) => CredentialKind::None,
        (Some(user), 0) => user,
        (Some(_), 1) if ambient_user => kinds.remove(0),
        (None, 1) => kinds.remove(0),
        _ => return Err(CredentialError::Conflicting),
    };
    Ok(RequestCredential { kind, user_tokens })
}

/// The token of an `Authorization: Bearer` value, its scheme in any case.
fn bearer(value: &str) -> Option<&str> {
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}
