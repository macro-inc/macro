use ::axum::{
    extract::{FromRef, FromRequestParts, Query},
    http::{header, request::Parts},
};
use macro_auth::headers::AccessTokenExtractor;
#[cfg(feature = "local_auth")]
use macro_env_var::maybe_env_vars;
#[cfg(feature = "local_auth")]
use model_user::UserContext;
use rootcause::Report;
use serde::Deserialize;

use crate::{MacroAuthorizationError, MacroAuthorizationService, MacroUserAuthentication};

use super::{MacroAuthorizationRejection, MacroAuthorizationState, authenticated_user, rejection};

#[cfg(feature = "local_auth")]
maybe_env_vars! {
    struct LocalUserId;
    struct LocalFusionUserId;
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct AuthorizationQuery {
    macro_api_token: Option<String>,
}

pub(super) fn explicit_user_credential_present(parts: &Parts) -> bool {
    query_user_credential_present(parts) || parts.headers.contains_key(header::AUTHORIZATION)
}

pub(super) async fn authorize_optional_user_request<S, Svc>(
    parts: &mut Parts,
    state: &S,
) -> Result<Option<MacroUserAuthentication>, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    let query_token = extract_query_token(parts, state).await;

    if explicit_user_credential_present(parts) {
        let token = extract_explicit_user_token(parts, state, query_token).await?;
        return authorize_user_token::<S, Svc>(state, &token)
            .await
            .map(Some);
    }

    #[cfg(feature = "local_auth")]
    if let Some(user_context) = local_user_context() {
        return authenticated_user(user_context).map(Some);
    }

    let Some(token) = extract_ambient_user_token(parts, state).await else {
        return Ok(None);
    };

    authorize_user_token::<S, Svc>(state, &token)
        .await
        .map(Some)
}

fn query_user_credential_present(parts: &Parts) -> bool {
    parts.uri.query().is_some_and(|query| {
        query.split('&').any(|parameter| {
            parameter
                .split_once('=')
                .map_or(parameter, |(name, _value)| name)
                == "macro-api-token"
        })
    })
}

async fn extract_query_token<S>(parts: &mut Parts, state: &S) -> Option<String>
where
    S: Send + Sync,
{
    Query::<AuthorizationQuery>::from_request_parts(parts, state)
        .await
        .ok()
        .and_then(|Query(query)| query.macro_api_token)
}

async fn extract_explicit_user_token<S>(
    parts: &mut Parts,
    state: &S,
    query_token: Option<String>,
) -> Result<String, MacroAuthorizationRejection>
where
    S: Send + Sync,
{
    if let Some(token) = query_token {
        return Ok(token);
    }

    match AccessTokenExtractor::from_request_parts(parts, state).await {
        Ok(token @ AccessTokenExtractor::Header(_)) => Ok(token.as_ref().to_owned()),
        Ok(AccessTokenExtractor::Cookie(_)) | Err(_) => Err(rejection("unauthorized")),
    }
}

async fn extract_ambient_user_token<S>(parts: &mut Parts, state: &S) -> Option<String>
where
    S: Send + Sync,
{
    AccessTokenExtractor::from_request_parts(parts, state)
        .await
        .ok()
        .map(|token| token.as_ref().to_owned())
}

#[cfg(feature = "local_auth")]
fn local_user_context() -> Option<UserContext> {
    Some(UserContext {
        user_id: LocalUserId::new()?.to_string(),
        fusion_user_id: LocalFusionUserId::new()
            .map(|fusion_user_id| fusion_user_id.to_string())
            .unwrap_or_else(|| "set me!".to_string()),
        organization_id: Some(1),
        permissions: None,
    })
}

async fn authorize_user_token<S, Svc>(
    state: &S,
    token: &str,
) -> Result<MacroUserAuthentication, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
{
    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let user_context = authorization
        .service
        .authorize(token)
        .await
        .map_err(authorization_rejection)?;

    authenticated_user(user_context)
}

fn authorization_rejection(error: Report<MacroAuthorizationError>) -> MacroAuthorizationRejection {
    let message = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired => "jwt expired",
        MacroAuthorizationError::InvalidCredentials
        | MacroAuthorizationError::ActingUserNotAuthorized
        | MacroAuthorizationError::BotScopeNotAuthorized
        | MacroAuthorizationError::Unavailable => "unauthorized",
    };
    tracing::error!(error=?error, "credential authorization failed");
    rejection(message)
}
