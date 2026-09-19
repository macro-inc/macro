use ::axum::{
    extract::FromRef,
    http::{HeaderMap, StatusCode, request::Parts},
};
use rootcause::Report;

use crate::{MacroAuthorizationError, MacroAuthorizationService, MacroUserAuthentication};

use super::{
    MacroAuthorizationRejection, MacroAuthorizationState, authenticated_user, rejection,
    status_rejection,
};

/// Header carrying a user API key.
pub const USER_API_KEY_HEADER: &str = "x-macro-user-api-key";

pub(super) async fn authorize_user_api_key_request<S, Svc>(
    parts: &Parts,
    state: &S,
) -> Result<MacroUserAuthentication, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
{
    let api_key = user_api_key(&parts.headers)?;
    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let user_context = authorization
        .service
        .authorize_user_api_key(&api_key)
        .await
        .map_err(user_api_key_authorization_rejection)?;

    authenticated_user(user_context)
}

fn user_api_key(headers: &HeaderMap) -> Result<String, MacroAuthorizationRejection> {
    let header = headers
        .get(USER_API_KEY_HEADER)
        .ok_or_else(|| rejection("unauthorized"))?;
    let key = header.to_str().map_err(|_| rejection("unauthorized"))?;
    if key.trim().is_empty() {
        return Err(rejection("unauthorized"));
    }

    Ok(key.to_owned())
}

fn user_api_key_authorization_rejection(
    error: Report<MacroAuthorizationError>,
) -> MacroAuthorizationRejection {
    let rejection = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired
        | MacroAuthorizationError::InvalidCredentials
        | MacroAuthorizationError::ActingUserNotAuthorized
        | MacroAuthorizationError::BotScopeNotAuthorized => rejection("unauthorized"),
        MacroAuthorizationError::Unavailable => {
            status_rejection(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        }
    };
    tracing::error!(error=?error, "user api key authorization failed");
    rejection
}
