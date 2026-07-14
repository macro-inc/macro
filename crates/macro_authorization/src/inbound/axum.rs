#[cfg(test)]
mod test;

use std::marker::PhantomData;

use ::axum::{
    Json,
    extract::{FromRef, FromRequestParts, Query},
    http::{HeaderValue, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use macro_auth::headers::AccessTokenExtractor;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;
use rootcause::Report;
use serde::Deserialize;
use thiserror::Error;

use crate::{MacroAuthorizationError, MacroAuthorizationService, SharedMacroAuthorizationService};

#[cfg(feature = "local_auth")]
macro_env_var::maybe_env_vars! {
    struct LocalUserId;
    struct LocalFusionUserId;
    struct LocalOrgId;
}

/// The reason request authorization was rejected.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MacroAuthorizationRejectionKind {
    /// The supplied credentials have expired.
    #[error("jwt expired")]
    CredentialsExpired,
    /// The supplied credentials are invalid.
    #[error("unauthorized")]
    InvalidCredentials,
    /// Credentials required by the extractor were not supplied.
    #[error("unauthorized")]
    MissingCredentials,
    /// The authorized context contained an invalid Macro user identifier.
    #[error("invalid user id")]
    InvalidUserId,
}

impl MacroAuthorizationRejectionKind {
    const fn www_authenticate(self) -> &'static str {
        match self {
            Self::CredentialsExpired => {
                "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
            }
            Self::InvalidCredentials | Self::MissingCredentials => {
                "Bearer error=\"invalid_token\", error_description=\"unauthorized\""
            }
            Self::InvalidUserId => {
                "Bearer error=\"invalid_token\", error_description=\"invalid user id\""
            }
        }
    }
}

/// Rejection returned when request credentials cannot authorize a user.
///
/// The response is always a JSON `401 Unauthorized` with an RFC 6750
/// `WWW-Authenticate` challenge. Its display text exactly matches the JSON
/// response message.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("{kind}")]
pub struct MacroAuthorizationRejection {
    kind: MacroAuthorizationRejectionKind,
}

impl MacroAuthorizationRejection {
    /// Return the reason request authorization was rejected.
    pub const fn kind(&self) -> MacroAuthorizationRejectionKind {
        self.kind
    }

    const fn new(kind: MacroAuthorizationRejectionKind) -> Self {
        Self { kind }
    }
}

impl IntoResponse for MacroAuthorizationRejection {
    fn into_response(self) -> Response {
        let mut response = (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response();
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static(self.kind.www_authenticate()),
        );
        response
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct AuthorizationQuery {
    macro_api_token: Option<String>,
}

#[derive(Clone)]
struct AuthorizedUser {
    macro_user_id: MacroUserIdStr<'static>,
    user_context: UserContext,
}

/// A request-local successful authorization outcome.
///
/// Applications must use one authorization service per request. Once an
/// extractor authorizes or identifies a request as anonymous, later extractors
/// reuse that first outcome even if they resolve a different service type.
#[derive(Clone)]
pub(crate) struct CachedAuthorization(Option<AuthorizedUser>);

/// Marker for a user context authorized before extractor execution.
///
/// This narrowly scoped identity channel is intended for middleware that has
/// already authenticated an internal request. A marker takes precedence over
/// request credentials.
#[cfg(feature = "internal-identity")]
#[derive(Clone, Debug)]
pub struct PreauthorizedContext(UserContext);

#[cfg(feature = "internal-identity")]
impl PreauthorizedContext {
    /// Create a marker from an already authorized user context.
    pub fn new(user_context: UserContext) -> Self {
        Self(user_context)
    }
}

/// Required authorization using the shared, type-erased service handle.
pub type SharedMacroAuthorizationExtractor =
    MacroAuthorizationExtractor<SharedMacroAuthorizationService>;

/// Optional authorization using the shared, type-erased service handle.
pub type OptionalSharedMacroAuthorizationExtractor =
    OptionalMacroAuthorizationExtractor<SharedMacroAuthorizationService>;

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
    Svc: FromRef<S> + MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Some(authorized_user) = authorize_request::<S, Svc>(parts, state).await? else {
            return Err(rejection(
                MacroAuthorizationRejectionKind::MissingCredentials,
            ));
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
    Svc: FromRef<S> + MacroAuthorizationService,
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
    Svc: FromRef<S> + MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    if let Some(cached) = parts.extensions.get::<CachedAuthorization>() {
        return Ok(cached.0.clone());
    }

    #[cfg(feature = "internal-identity")]
    if let Some(user_context) = parts
        .extensions
        .get::<PreauthorizedContext>()
        .map(|marker| marker.0.clone())
    {
        let outcome = preauthorized_user(user_context)?;
        cache_authorization(parts, &outcome);
        return Ok(outcome);
    }

    #[cfg(feature = "local_auth")]
    if let Some(authorized_user) = local_authorized_user()? {
        let outcome = Some(authorized_user);
        cache_authorization(parts, &outcome);
        return Ok(outcome);
    }

    let Some(token) = extract_token(parts, state).await? else {
        cache_authorization(parts, &None);
        return Ok(None);
    };

    let service = Svc::from_ref(state);
    let user_context = service
        .authorize(&token)
        .await
        .map_err(authorization_rejection)?;
    let outcome = Some(authorized_user(user_context)?);
    cache_authorization(parts, &outcome);
    Ok(outcome)
}

fn cache_authorization(parts: &mut Parts, outcome: &Option<AuthorizedUser>) {
    parts
        .extensions
        .insert(CachedAuthorization(outcome.clone()));
}

#[cfg(feature = "internal-identity")]
fn preauthorized_user(
    user_context: UserContext,
) -> Result<Option<AuthorizedUser>, MacroAuthorizationRejection> {
    if user_context.user_id.is_empty() {
        return Ok(None);
    }

    authorized_user(user_context).map(Some)
}

#[cfg(feature = "local_auth")]
fn local_authorized_user() -> Result<Option<AuthorizedUser>, MacroAuthorizationRejection> {
    let Some(user_id) = LocalUserId::new().map(|user_id| user_id.to_string()) else {
        return Ok(None);
    };

    let organization_id = LocalOrgId::new()
        .map(|organization_id| {
            organization_id.parse::<i32>().map_err(|error| {
                tracing::error!(error=?error, "LOCAL_ORG_ID is not a valid i32");
                rejection(MacroAuthorizationRejectionKind::InvalidUserId)
            })
        })
        .transpose()?
        .unwrap_or(1);
    let user_context = UserContext {
        user_id,
        fusion_user_id: LocalFusionUserId::new()
            .map(|fusion_user_id| fusion_user_id.to_string())
            .unwrap_or_else(|| "set me!".to_string()),
        organization_id: Some(organization_id),
        permissions: None,
    };

    authorized_user(user_context).map(Some)
}

fn authorized_user(
    user_context: UserContext,
) -> Result<AuthorizedUser, MacroAuthorizationRejection> {
    let macro_user_id = MacroUserIdStr::parse_from_str(&user_context.user_id)
        .map(CowLike::into_owned)
        .map_err(|error| {
            tracing::error!(error=?error, "authorized context contained invalid macro user id");
            rejection(MacroAuthorizationRejectionKind::InvalidUserId)
        })?;

    Ok(AuthorizedUser {
        macro_user_id,
        user_context,
    })
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
        Err(_) if parts.headers.contains_key(header::AUTHORIZATION) => Err(rejection(
            MacroAuthorizationRejectionKind::InvalidCredentials,
        )),
        Err(_) => Ok(None),
    }
}

fn authorization_rejection(error: Report<MacroAuthorizationError>) -> MacroAuthorizationRejection {
    let kind = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired => {
            tracing::debug!(error=?error, "credentials expired");
            MacroAuthorizationRejectionKind::CredentialsExpired
        }
        MacroAuthorizationError::InvalidCredentials => {
            tracing::error!(error=?error, "credential authorization failed");
            MacroAuthorizationRejectionKind::InvalidCredentials
        }
    };

    rejection(kind)
}

const fn rejection(kind: MacroAuthorizationRejectionKind) -> MacroAuthorizationRejection {
    MacroAuthorizationRejection::new(kind)
}
