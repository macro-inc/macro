#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use ::axum::{
    Json,
    extract::{FromRef, FromRequestParts, Query},
    http::{StatusCode, header, request::Parts},
};
use macro_auth::headers::AccessTokenExtractor;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;
use rootcause::Report;
use serde::Deserialize;

use crate::{MacroAuthorizationError, MacroAuthorizationService};

/// Rejection returned when request credentials cannot authorize a user.
pub type MacroAuthorizationRejection = (StatusCode, Json<ErrorResponse<'static>>);

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct AuthorizationQuery {
    macro_api_token: Option<String>,
}

struct AuthorizedUser {
    macro_user_id: MacroUserIdStr<'static>,
    user_context: UserContext,
}

/// Extracts and authorizes credentials for a required authenticated user.
///
/// Credentials are read from the `macro-api-token` query parameter first,
/// followed by a bearer header or access-token cookie. The authorization
/// service is resolved from Axum state.
#[non_exhaustive]
pub struct MacroAuthorizationExtractor<Svc> {
    /// The validated Macro user identifier.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The complete context returned by the authorization service.
    pub user_context: UserContext,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> Clone for MacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            macro_user_id: self.macro_user_id.clone(),
            user_context: self.user_context.clone(),
            _service: PhantomData,
        }
    }
}

impl<S, Svc> FromRequestParts<S> for MacroAuthorizationExtractor<Svc>
where
    Arc<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Some(authorized_user) = authorize_request::<S, Svc>(parts, state).await? else {
            return Err(rejection("unauthorized"));
        };

        Ok(Self {
            macro_user_id: authorized_user.macro_user_id,
            user_context: authorized_user.user_context,
            _service: PhantomData,
        })
    }
}

/// Extracts and authorizes credentials when an authenticated user is present.
///
/// Requests without credentials succeed with an empty [`UserContext`]. Any
/// supplied credential must still pass authorization.
#[non_exhaustive]
pub struct OptionalMacroAuthorizationExtractor<Svc> {
    /// The validated Macro user identifier, or `None` for an anonymous request.
    pub macro_user_id: Option<MacroUserIdStr<'static>>,
    /// The authorized context, or the default context for an anonymous request.
    pub user_context: UserContext,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> Clone for OptionalMacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            macro_user_id: self.macro_user_id.clone(),
            user_context: self.user_context.clone(),
            _service: PhantomData,
        }
    }
}

impl<S, Svc> FromRequestParts<S> for OptionalMacroAuthorizationExtractor<Svc>
where
    Arc<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Some(authorized_user) = authorize_request::<S, Svc>(parts, state).await? else {
            return Ok(Self {
                macro_user_id: None,
                user_context: UserContext::default(),
                _service: PhantomData,
            });
        };

        Ok(Self {
            macro_user_id: Some(authorized_user.macro_user_id),
            user_context: authorized_user.user_context,
            _service: PhantomData,
        })
    }
}

async fn authorize_request<S, Svc>(
    parts: &mut Parts,
    state: &S,
) -> Result<Option<AuthorizedUser>, MacroAuthorizationRejection>
where
    Arc<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    let Some(token) = extract_token(parts, state).await? else {
        return Ok(None);
    };

    let service = Arc::<Svc>::from_ref(state);
    let user_context = service
        .authorize(&token)
        .await
        .map_err(authorization_rejection)?;
    let macro_user_id = MacroUserIdStr::parse_from_str(&user_context.user_id)
        .map(CowLike::into_owned)
        .map_err(|error| {
            tracing::error!(error=?error, "authorized context contained invalid macro user id");
            rejection("invalid user id")
        })?;

    Ok(Some(AuthorizedUser {
        macro_user_id,
        user_context,
    }))
}

async fn extract_token<S>(
    parts: &mut Parts,
    state: &S,
) -> Result<Option<String>, MacroAuthorizationRejection>
where
    S: Send + Sync,
{
    let query_token = Query::<AuthorizationQuery>::from_request_parts(parts, state)
        .await
        .ok()
        .and_then(|Query(query)| query.macro_api_token);

    if let Some(token) = query_token {
        return Ok(Some(token));
    }

    match AccessTokenExtractor::from_request_parts(parts, state).await {
        Ok(token) => Ok(Some(token.as_ref().to_owned())),
        Err(_) if parts.headers.contains_key(header::AUTHORIZATION) => {
            Err(rejection("unauthorized"))
        }
        Err(_) => Ok(None),
    }
}

fn authorization_rejection(error: Report<MacroAuthorizationError>) -> MacroAuthorizationRejection {
    let message = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired => "jwt expired",
        MacroAuthorizationError::InvalidCredentials => "unauthorized",
    };
    tracing::error!(error=?error, "credential authorization failed");
    rejection(message)
}

fn rejection(message: &'static str) -> MacroAuthorizationRejection {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
}
