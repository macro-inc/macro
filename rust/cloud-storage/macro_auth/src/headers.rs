use cookie::Cookie;
use macro_env::Environment;

use crate::{
    constant::{MACRO_ACCESS_TOKEN_COOKIE, MACRO_REFRESH_TOKEN_COOKIE, MACRO_REFRESH_TOKEN_HEADER},
    error::MacroAuthError,
};

pub fn extract_access_token_from_request_headers(
    headers: &axum::http::HeaderMap,
) -> Result<String, MacroAuthError> {
    let auth_token_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|header| header.to_str().ok());

    let jwt = if let Some(auth_token) = auth_token_header {
        let auth_token_parts = auth_token.split("Bearer ").collect::<Vec<&str>>();
        if auth_token_parts.len() != 2 {
            return Err(MacroAuthError::InvalidAuthorizationHeaderFormat);
        }
        tracing::trace!("Authorization header provided");
        Some(auth_token_parts[1].to_string())
    } else {
        // Check for cookie
        tracing::trace!("no Authorization header provided. checking for cookie");
        let cookie_header = headers
            .get(axum::http::header::COOKIE)
            .and_then(|header| header.to_str().ok());
        let cookie_jwt = if let Some(header) = cookie_header {
            header.split(';').find_map(|cookie| {
                let cookie = Cookie::parse(cookie).ok()?;
                // If the environment is prod, we want to use the base name for the cookie
                // Otherwise, we want to prefix the cookie name with dev-
                let access_token_cookie_name = match Environment::new_or_prod() {
                    Environment::Production => MACRO_ACCESS_TOKEN_COOKIE,
                    Environment::Local | Environment::Develop => {
                        &format!("dev-{MACRO_ACCESS_TOKEN_COOKIE}")
                    }
                };

                if cookie.name() == access_token_cookie_name {
                    Some(cookie.value().to_owned())
                } else {
                    None
                }
            })
        } else {
            None
        };
        cookie_jwt.clone()
    };

    if let Some(jwt) = jwt {
        return Ok(jwt);
    }

    Err(MacroAuthError::NoAccessTokenProvided)
}

pub fn extract_refresh_token_from_request_headers(
    headers: &axum::http::HeaderMap,
) -> Result<String, MacroAuthError> {
    let token_header = headers
        .get(MACRO_REFRESH_TOKEN_HEADER)
        .and_then(|header| header.to_str().ok());

    let token: Option<String> = if let Some(token) = token_header {
        Some(token.to_string())
    } else {
        // Check for cookie
        tracing::trace!("no x-macro-refresh-token header provided. checking for cookie");
        let cookie_header = headers
            .get(axum::http::header::COOKIE)
            .and_then(|header| header.to_str().ok());
        let cookie_jwt = if let Some(header) = cookie_header {
            header.split(';').find_map(|cookie| {
                let cookie = Cookie::parse(cookie).ok()?;
                let refresh_token_cookie_name = match Environment::new_or_prod() {
                    Environment::Production => MACRO_REFRESH_TOKEN_COOKIE,
                    Environment::Local | Environment::Develop => {
                        &format!("dev-{MACRO_REFRESH_TOKEN_COOKIE}")
                    }
                };
                if cookie.name() == refresh_token_cookie_name {
                    Some(cookie.value().to_owned())
                } else {
                    None
                }
            })
        } else {
            None
        };
        cookie_jwt.clone()
    };

    if let Some(token) = token {
        return Ok(token);
    }

    Err(MacroAuthError::NoRefreshTokenProvided)
}
