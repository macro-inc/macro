use std::sync::LazyLock;

use axum::{RequestPartsExt, extract::FromRequestParts, http::StatusCode};
use axum_extra::{
    TypedHeader,
    either::Either,
    extract::CookieJar,
    headers::{Authorization, authorization::Bearer},
};
use cookie::Cookie;
use macro_env::Environment;

use crate::constant::{MACRO_REFRESH_TOKEN_COOKIE, MACRO_REFRESH_TOKEN_HEADER};

/// Extracts the access token from a cookie. Returns `UNAUTHORIZED` if the cookie is missing.
pub struct AccessTokenCookieExtractor(pub Cookie<'static>);

impl<S> FromRequestParts<S> for AccessTokenCookieExtractor
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let jar: CookieJar = parts.extract().await.expect("This extractor is infallible");
        match jar.get(crate::credential::access_token_cookie_name()) {
            Some(c) => Ok(Self(c.clone())),
            None => Err(StatusCode::UNAUTHORIZED),
        }
    }
}
/// Extracts the refresh token from a cookie. Returns `UNAUTHORIZED` if the cookie is missing.
pub struct RefreshTokenCookieExtractor(pub Cookie<'static>);

impl<S> FromRequestParts<S> for RefreshTokenCookieExtractor
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let jar: CookieJar = parts.extract().await.expect("This extractor is infallible");
        static REFRESH_COOKIE_NAME: LazyLock<String> =
            LazyLock::new(|| match Environment::new_or_prod() {
                Environment::Production => MACRO_REFRESH_TOKEN_COOKIE.to_string(),
                Environment::Develop => format!("dev-{MACRO_REFRESH_TOKEN_COOKIE}"),
                Environment::Local => format!("local-{MACRO_REFRESH_TOKEN_COOKIE}"),
            });

        match jar.get(&REFRESH_COOKIE_NAME) {
            Some(c) => Ok(Self(c.clone())),
            None => Err(StatusCode::UNAUTHORIZED),
        }
    }
}

/// The request's user token as [`crate::credential::request_credential`] reads
/// it, so every reader agrees on it: a `macro-api-token` query parameter or
/// bearer (both as `Header`), else the access-token cookie. Returns
/// `UNAUTHORIZED` when the request authenticates with no user token, and
/// `BAD_REQUEST` when its credentials can't be told apart.
pub enum AccessTokenExtractor {
    Header(TypedHeader<Authorization<Bearer>>),
    Cookie(AccessTokenCookieExtractor),
}

impl AsRef<str> for AccessTokenExtractor {
    fn as_ref(&self) -> &str {
        match self {
            AccessTokenExtractor::Header(typed_header) => typed_header.token(),
            AccessTokenExtractor::Cookie(access_token_cookie_extractor) => {
                access_token_cookie_extractor.0.value_trimmed()
            }
        }
    }
}

impl<S> FromRequestParts<S> for AccessTokenExtractor
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let credential =
            crate::credential::request_credential(parts).map_err(|_| StatusCode::BAD_REQUEST)?;
        let crate::credential::CredentialKind::UserToken { token, source } = credential.kind else {
            return Err(StatusCode::UNAUTHORIZED);
        };
        Ok(match source {
            crate::credential::TokenSource::Query | crate::credential::TokenSource::Bearer => {
                Self::Header(TypedHeader(
                    Authorization::bearer(&token).map_err(|_| StatusCode::UNAUTHORIZED)?,
                ))
            }
            crate::credential::TokenSource::Cookie => Self::Cookie(AccessTokenCookieExtractor(
                Cookie::new(crate::credential::access_token_cookie_name(), token),
            )),
        })
    }
}

/// Extracts the refresh token from a custom header. Returns `BAD_REQUEST` if the header is missing.
pub struct RefreshTokenHeaderExtractor(pub String);

impl<S> FromRequestParts<S> for RefreshTokenHeaderExtractor
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Some(header) = parts
            .headers
            .get(MACRO_REFRESH_TOKEN_HEADER)
            .and_then(|h| h.to_str().ok())
        else {
            return Err(StatusCode::BAD_REQUEST);
        };
        Ok(Self(header.to_string()))
    }
}

/// Extracts the refresh token from either a custom header or a cookie.
/// Returns `UNAUTHORIZED` if neither source provides a token.
pub enum RefreshTokenExtractor {
    Header(RefreshTokenHeaderExtractor),
    Cookie(RefreshTokenCookieExtractor),
}

impl AsRef<str> for RefreshTokenExtractor {
    fn as_ref(&self) -> &str {
        match self {
            RefreshTokenExtractor::Header(refresh_token_header_extractor) => {
                &refresh_token_header_extractor.0
            }
            RefreshTokenExtractor::Cookie(refresh_token_cookie_extractor) => {
                refresh_token_cookie_extractor.0.value_trimmed()
            }
        }
    }
}

impl<S> FromRequestParts<S> for RefreshTokenExtractor
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let either: Either<RefreshTokenHeaderExtractor, RefreshTokenCookieExtractor> =
            parts.extract().await?;
        Ok(match either {
            Either::E1(l) => Self::Header(l),
            Either::E2(r) => Self::Cookie(r),
        })
    }
}
