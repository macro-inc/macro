#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use ::axum::{
    Json,
    extract::{FromRef, FromRequestParts, Query},
    http::{HeaderMap, StatusCode, header, request::Parts},
};
use macro_auth::headers::AccessTokenExtractor;
#[cfg(feature = "local_auth")]
use macro_env_var::maybe_env_vars;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;
use rootcause::Report;
use serde::Deserialize;

use crate::{InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService};

/// Header carrying the shared key for standard internal service authorization.
pub const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";
/// Header carrying the acting Macro user ID for standard internal authorization.
pub const INTERNAL_MACRO_USER_ID_HEADER: &str = "x-internal-macro-user-id";
/// Header carrying the acting organization ID for standard internal authorization.
pub const INTERNAL_MACRO_ORGANIZATION_ID_HEADER: &str = "x-internal-macro-organization-id";
/// Header carrying the acting FusionAuth user ID for standard internal authorization.
pub const INTERNAL_FUSIONAUTH_USER_ID_HEADER: &str = "x-internal-fusionauth-user-id";

/// Legacy DSS header carrying the internal service authorization key.
#[deprecated(note = "migrate callers to INTERNAL_API_KEY_HEADER")]
pub const LEGACY_DSS_INTERNAL_API_KEY_HEADER: &str = "x-document-storage-service-auth-key";
/// Legacy DSS header carrying the acting Macro user ID.
#[deprecated(note = "migrate callers to INTERNAL_MACRO_USER_ID_HEADER")]
pub const LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER: &str = "x-document-storage-service-user-id";

/// Rejection returned when request credentials cannot authorize a user.
pub type MacroAuthorizationRejection = (StatusCode, Json<ErrorResponse<'static>>);

/// Axum state containing the service used by authorization extractors.
pub struct MacroAuthorizationState<Svc> {
    service: Arc<Svc>,
}

impl<Svc> MacroAuthorizationState<Svc> {
    /// Create authorization state backed by the supplied service.
    pub fn new(service: Arc<Svc>) -> Self {
        Self { service }
    }
}

impl<Svc> Clone for MacroAuthorizationState<Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

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

struct AuthorizedUser {
    macro_user_id: MacroUserIdStr<'static>,
    user_context: UserContext,
}

struct AuthorizationOutcome {
    identity: Option<AuthorizedUser>,
    is_internal_access: bool,
}

struct InternalHeaderConvention {
    key_header: &'static str,
    user_id_header: &'static str,
    organization_id_header: Option<&'static str>,
    fusion_user_id_header: Option<&'static str>,
}

#[allow(deprecated)]
static INTERNAL_HEADER_CONVENTIONS: [InternalHeaderConvention; 2] = [
    InternalHeaderConvention {
        key_header: INTERNAL_API_KEY_HEADER,
        user_id_header: INTERNAL_MACRO_USER_ID_HEADER,
        organization_id_header: Some(INTERNAL_MACRO_ORGANIZATION_ID_HEADER),
        fusion_user_id_header: Some(INTERNAL_FUSIONAUTH_USER_ID_HEADER),
    },
    InternalHeaderConvention {
        key_header: LEGACY_DSS_INTERNAL_API_KEY_HEADER,
        user_id_header: LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
        organization_id_header: None,
        fusion_user_id_header: None,
    },
];

/// Extracts and authorizes credentials for a required authenticated user.
///
/// Internal service credentials are checked first. User credentials are read
/// from the `macro-api-token` query parameter, followed by a bearer header or
/// access-token cookie. The authorization service is resolved from Axum state.
#[non_exhaustive]
pub struct MacroAuthorizationExtractor<Svc> {
    /// The validated Macro user identifier.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The complete context returned by the authorization service.
    pub user_context: UserContext,
    /// True when the request authenticated with an internal service key rather than user credentials.
    pub is_internal_access: bool,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> Clone for MacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            macro_user_id: self.macro_user_id.clone(),
            user_context: self.user_context.clone(),
            is_internal_access: self.is_internal_access,
            _service: PhantomData,
        }
    }
}

impl<S, Svc> FromRequestParts<S> for MacroAuthorizationExtractor<Svc>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let outcome = authorize_request::<S, Svc>(parts, state).await?;
        let Some(authorized_user) = outcome.identity else {
            return Err(rejection("unauthorized"));
        };

        Ok(Self {
            macro_user_id: authorized_user.macro_user_id,
            user_context: authorized_user.user_context,
            is_internal_access: outcome.is_internal_access,
            _service: PhantomData,
        })
    }
}

/// Authorizes an internal service request using its internal API key.
///
/// Both the standard and legacy DSS internal API key headers are accepted.
/// Acting-user identity headers are forwarded to the authorization service so
/// it can construct a user context, but only the internal API key is required.
#[non_exhaustive]
pub struct InternalMacroAuthorizationExtractor<Svc> {
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> Clone for InternalMacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            _service: PhantomData,
        }
    }
}

impl<S, Svc> FromRequestParts<S> for InternalMacroAuthorizationExtractor<Svc>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let convention =
            internal_header_convention(&parts.headers).ok_or_else(|| rejection("unauthorized"))?;

        authorize_internal_request::<S, Svc>(parts, state, convention).await?;

        Ok(Self {
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
    /// True when the request authenticated with an internal service key rather than user credentials.
    pub is_internal_access: bool,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> Clone for OptionalMacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            macro_user_id: self.macro_user_id.clone(),
            user_context: self.user_context.clone(),
            is_internal_access: self.is_internal_access,
            _service: PhantomData,
        }
    }
}

impl<S, Svc> FromRequestParts<S> for OptionalMacroAuthorizationExtractor<Svc>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let outcome = authorize_request::<S, Svc>(parts, state).await?;
        let Some(authorized_user) = outcome.identity else {
            return Ok(Self {
                macro_user_id: None,
                user_context: UserContext::default(),
                is_internal_access: outcome.is_internal_access,
                _service: PhantomData,
            });
        };

        Ok(Self {
            macro_user_id: Some(authorized_user.macro_user_id),
            user_context: authorized_user.user_context,
            is_internal_access: outcome.is_internal_access,
            _service: PhantomData,
        })
    }
}

async fn authorize_request<S, Svc>(
    parts: &mut Parts,
    state: &S,
) -> Result<AuthorizationOutcome, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    if let Some(convention) = internal_header_convention(&parts.headers) {
        return authorize_internal_request::<S, Svc>(parts, state, convention).await;
    }

    #[cfg(feature = "local_auth")]
    if let Some(user_context) = local_user_context() {
        return authorization_outcome(Some(user_context), false);
    }

    let Some(token) = extract_token(parts, state).await? else {
        return Ok(AuthorizationOutcome {
            identity: None,
            is_internal_access: false,
        });
    };

    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let user_context = authorization
        .service
        .authorize(&token)
        .await
        .map_err(authorization_rejection)?;

    authorization_outcome(Some(user_context), false)
}

async fn authorize_internal_request<S, Svc>(
    parts: &Parts,
    state: &S,
    convention: &InternalHeaderConvention,
) -> Result<AuthorizationOutcome, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    let provided_key = parts
        .headers
        .get(convention.key_header)
        .and_then(|header| header.to_str().ok())
        .ok_or_else(|| rejection("unauthorized"))?;
    let claims = internal_identity_claims(&parts.headers, convention);
    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let user_context = authorization
        .service
        .authorize_internal(provided_key, claims)
        .await
        .map_err(internal_authorization_rejection)?;

    authorization_outcome(user_context, true)
}

fn authorization_outcome(
    user_context: Option<UserContext>,
    is_internal_access: bool,
) -> Result<AuthorizationOutcome, MacroAuthorizationRejection> {
    let identity = user_context.map(authorized_user).transpose()?;

    Ok(AuthorizationOutcome {
        identity,
        is_internal_access,
    })
}

fn authorized_user(
    user_context: UserContext,
) -> Result<AuthorizedUser, MacroAuthorizationRejection> {
    let macro_user_id = MacroUserIdStr::parse_from_str(&user_context.user_id)
        .map(CowLike::into_owned)
        .map_err(|error| {
            tracing::error!(error=?error, "authorized context contained invalid macro user id");
            rejection("invalid user id")
        })?;

    Ok(AuthorizedUser {
        macro_user_id,
        user_context,
    })
}

fn internal_header_convention(headers: &HeaderMap) -> Option<&InternalHeaderConvention> {
    INTERNAL_HEADER_CONVENTIONS
        .iter()
        .find(|convention| headers.contains_key(convention.key_header))
}

fn internal_identity_claims(
    headers: &HeaderMap,
    convention: &InternalHeaderConvention,
) -> InternalIdentityClaims {
    InternalIdentityClaims {
        user_id: header_string(headers, Some(convention.user_id_header)),
        fusion_user_id: header_string(headers, convention.fusion_user_id_header),
        organization_id: header_string(headers, convention.organization_id_header)
            .and_then(|organization_id| organization_id.parse().ok()),
    }
}

fn header_string(headers: &HeaderMap, name: Option<&str>) -> Option<String> {
    name.and_then(|name| headers.get(name))
        .and_then(|header| header.to_str().ok())
        .map(str::to_owned)
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

fn internal_authorization_rejection(
    error: Report<MacroAuthorizationError>,
) -> MacroAuthorizationRejection {
    tracing::error!(error=?error.current_context(), "internal authorization failed");
    rejection("unauthorized")
}

fn rejection(message: &'static str) -> MacroAuthorizationRejection {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
}
