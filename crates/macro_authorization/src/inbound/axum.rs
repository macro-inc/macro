#[cfg(test)]
mod test;

use std::{borrow::Cow, fmt, marker::PhantomData, sync::Arc};

use ::axum::{
    Json,
    extract::{FromRef, FromRequestParts, OptionalFromRequestParts, Query},
    http::{HeaderMap, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use macro_auth::headers::AccessTokenExtractor;
#[cfg(feature = "local_auth")]
use macro_env_var::maybe_env_vars;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;
use rootcause::Report;
use serde::Deserialize;

use crate::{
    BotActingUserClaims, BotAuthentication, InternalIdentityClaims, MacroAuthorization,
    MacroAuthorizationError, MacroAuthorizationService, MacroUserAuthentication,
};

/// Header carrying a bot authentication token.
pub const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
/// Header carrying the Macro user ID a bot claims to act for.
pub const BOT_FOR_MACRO_USER_ID_HEADER: &str = "x-macro-bot-for-macro-user-id";
/// Header carrying the FusionAuth user ID a bot claims to act for.
pub const BOT_FOR_FUSIONAUTH_USER_ID_HEADER: &str = "x-macro-bot-for-fusionauth-user-id";
/// Header carrying the organization ID a bot claims to act for.
pub const BOT_FOR_ORGANIZATION_ID_HEADER: &str = "x-macro-bot-for-organization-id";

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
#[derive(Clone, Debug)]
pub struct MacroAuthorizationRejection {
    /// HTTP status returned to the client.
    pub status: StatusCode,
    /// Client-safe error message returned in the response body.
    pub message: Cow<'static, str>,
}

impl fmt::Display for MacroAuthorizationRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for MacroAuthorizationRejection {}

impl IntoResponse for MacroAuthorizationRejection {
    fn into_response(self) -> Response {
        let Self { status, message } = self;
        (status, Json(ErrorResponse { message })).into_response()
    }
}

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

/// Extracts and authorizes a required acting user.
///
/// This extractor supports direct user, bot, and internal service credentials.
/// A bot or internal caller must resolve to an acting user. Supplying more than
/// one explicit credential type is rejected; an access-token cookie is ambient
/// and is used only when no explicit credential is present. Use a dedicated
/// extractor instead when being bot-only or internal-only is part of the
/// endpoint's contract. The authorization service is resolved from Axum state.
#[non_exhaustive]
pub struct MacroAuthorizationExtractor<Svc> {
    /// The typed authorization principal established for the request.
    pub authorization: MacroAuthorization,
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
            authorization: self.authorization.clone(),
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
        let authorization = authorize_request::<S, Svc>(parts, state)
            .await?
            .ok_or_else(|| rejection("unauthorized"))?;
        let authorized_user = authorization
            .acting_user()
            .ok_or_else(|| rejection("unauthorized"))?;
        let macro_user_id = authorized_user.macro_user_id.clone();
        let user_context = authorized_user.user_context.clone();
        let is_internal_access = authorization.is_internal();

        Ok(Self {
            authorization,
            macro_user_id,
            user_context,
            is_internal_access,
            _service: PhantomData,
        })
    }
}

/// Authorizes an exclusively internal service endpoint using an internal API key.
///
/// Use this extractor only for endpoints that will never accept direct user
/// access. Do not use it merely to support internal callers:
/// [`MacroAuthorizationExtractor`] and [`OptionalMacroAuthorizationExtractor`]
/// already accept internal credentials automatically. This extractor does not
/// accept user credentials as a substitute and intentionally exposes no user
/// identity.
///
/// Both the standard and legacy DSS internal API key headers are accepted.
/// Acting-user identity headers are forwarded to the authorization service so
/// it can validate any supplied identity, but only the internal API key is
/// required.
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

/// Authorizes an exclusively bot-token endpoint.
///
/// Use this extractor only when bot-only access is part of the endpoint's
/// security contract. User and internal credentials are not substitutes. The
/// extractor validates only the bot credential, ignores other credential
/// types, and carries the validated bot principal without retaining its token.
#[non_exhaustive]
pub struct BotMacroAuthorizationExtractor<Svc> {
    /// The validated bot principal.
    pub bot: BotAuthentication,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> Clone for BotMacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            bot: self.bot.clone(),
            _service: PhantomData,
        }
    }
}

impl<S, Svc> FromRequestParts<S> for BotMacroAuthorizationExtractor<Svc>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let bot = authorize_optional_bot_request::<S, Svc>(parts, state)
            .await?
            .ok_or_else(|| rejection("unauthorized"))?;

        Ok(Self {
            bot,
            _service: PhantomData,
        })
    }
}

impl<S, Svc> OptionalFromRequestParts<S> for BotMacroAuthorizationExtractor<Svc>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        let Some(bot) = authorize_optional_bot_request::<S, Svc>(parts, state).await? else {
            return Ok(None);
        };

        Ok(Some(Self {
            bot,
            _service: PhantomData,
        }))
    }
}

/// Extracts and authorizes an optional acting user.
///
/// This extractor supports anonymous, direct user, bot, and internal service
/// callers. Requests without credentials succeed with an empty [`UserContext`].
/// Supplying more than one explicit credential type is rejected; an ambient
/// access-token cookie is considered only when no explicit credential exists.
/// Any supplied credential must pass authorization and is never treated as
/// anonymous. Identityless internal and bot principals remain visible through
/// `authorization` even though their user convenience fields are empty.
#[non_exhaustive]
pub struct OptionalMacroAuthorizationExtractor<Svc> {
    /// The typed authorization principal, or `None` for an anonymous request.
    pub authorization: Option<MacroAuthorization>,
    /// The validated Macro user identifier, or `None` when there is no acting user.
    pub macro_user_id: Option<MacroUserIdStr<'static>>,
    /// The authorized context, or the default context when there is no acting user.
    pub user_context: UserContext,
    /// True when the request authenticated with an internal service key rather than user credentials.
    pub is_internal_access: bool,
    _service: PhantomData<fn() -> Svc>,
}

impl<Svc> Clone for OptionalMacroAuthorizationExtractor<Svc> {
    fn clone(&self) -> Self {
        Self {
            authorization: self.authorization.clone(),
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
        let authorization = authorize_request::<S, Svc>(parts, state).await?;
        let (macro_user_id, user_context) = match authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)
        {
            Some(authorized_user) => (
                Some(authorized_user.macro_user_id.clone()),
                authorized_user.user_context.clone(),
            ),
            None => (None, UserContext::default()),
        };
        let is_internal_access = authorization
            .as_ref()
            .is_some_and(MacroAuthorization::is_internal);

        Ok(Self {
            authorization,
            macro_user_id,
            user_context,
            is_internal_access,
            _service: PhantomData,
        })
    }
}

async fn authorize_request<S, Svc>(
    parts: &mut Parts,
    state: &S,
) -> Result<Option<MacroAuthorization>, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    let query_token = extract_query_token(parts, state).await;
    let internal_convention = internal_header_convention(&parts.headers);
    let has_bot_token = parts.headers.contains_key(BOT_TOKEN_HEADER);
    let has_explicit_user_credential =
        query_user_credential_present(parts) || parts.headers.contains_key(header::AUTHORIZATION);
    let explicit_credential_count = usize::from(internal_convention.is_some())
        + usize::from(has_bot_token)
        + usize::from(has_explicit_user_credential);

    if explicit_credential_count > 1 {
        return Err(status_rejection(
            StatusCode::BAD_REQUEST,
            "ambiguous credentials",
        ));
    }

    if let Some(convention) = internal_convention {
        return authorize_internal_request::<S, Svc>(parts, state, convention).await;
    }

    if has_bot_token {
        let bot = authorize_optional_bot_request::<S, Svc>(parts, state)
            .await?
            .expect("bot token presence was checked");
        return Ok(Some(MacroAuthorization::Bot(bot)));
    }

    if has_explicit_user_credential {
        let token = extract_explicit_user_token(parts, state, query_token).await?;
        return authorize_user_token::<S, Svc>(state, &token)
            .await
            .map(Some);
    }

    #[cfg(feature = "local_auth")]
    if let Some(user_context) = local_user_context() {
        return authenticated_user(user_context)
            .map(MacroAuthorization::User)
            .map(Some);
    }

    let Some(token) = extract_ambient_user_token(parts, state).await else {
        return Ok(None);
    };

    authorize_user_token::<S, Svc>(state, &token)
        .await
        .map(Some)
}

async fn authorize_internal_request<S, Svc>(
    parts: &Parts,
    state: &S,
    convention: &InternalHeaderConvention,
) -> Result<Option<MacroAuthorization>, MacroAuthorizationRejection>
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
    let acting_user = user_context.map(authenticated_user).transpose()?;

    Ok(Some(MacroAuthorization::Internal(acting_user)))
}

fn authenticated_user(
    user_context: UserContext,
) -> Result<MacroUserAuthentication, MacroAuthorizationRejection> {
    let macro_user_id = MacroUserIdStr::parse_from_str(&user_context.user_id)
        .map(CowLike::into_owned)
        .map_err(|error| {
            tracing::error!(error=?error, "authorized context contained invalid macro user id");
            rejection("invalid user id")
        })?;

    Ok(MacroUserAuthentication {
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

async fn authorize_user_token<S, Svc>(
    state: &S,
    token: &str,
) -> Result<MacroAuthorization, MacroAuthorizationRejection>
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

    authenticated_user(user_context).map(MacroAuthorization::User)
}

async fn authorize_optional_bot_request<S, Svc>(
    parts: &Parts,
    state: &S,
) -> Result<Option<BotAuthentication>, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
{
    let Some(token) = bot_token(&parts.headers)? else {
        return Ok(None);
    };
    let claims = bot_acting_user_claims(&parts.headers)?;
    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let bot = authorization
        .service
        .authorize_bot(&token, claims)
        .await
        .map_err(bot_authorization_rejection)?;

    Ok(Some(bot))
}

fn bot_token(headers: &HeaderMap) -> Result<Option<String>, MacroAuthorizationRejection> {
    let Some(header) = headers.get(BOT_TOKEN_HEADER) else {
        return Ok(None);
    };
    let token = header.to_str().map_err(|_| rejection("unauthorized"))?;
    if token.trim().is_empty() {
        return Err(rejection("unauthorized"));
    }

    Ok(Some(token.to_owned()))
}

fn bot_acting_user_claims(
    headers: &HeaderMap,
) -> Result<Option<BotActingUserClaims>, MacroAuthorizationRejection> {
    let user_id = bot_claim_header(headers, BOT_FOR_MACRO_USER_ID_HEADER)?;
    let fusion_user_id = bot_claim_header(headers, BOT_FOR_FUSIONAUTH_USER_ID_HEADER)?;
    let organization_id = bot_claim_header(headers, BOT_FOR_ORGANIZATION_ID_HEADER)?
        .map(|organization_id| organization_id.parse::<i32>())
        .transpose()
        .map_err(|_| invalid_bot_claims_rejection())?;

    if user_id.is_none() && fusion_user_id.is_none() && organization_id.is_none() {
        return Ok(None);
    }

    Ok(Some(BotActingUserClaims {
        user_id,
        fusion_user_id,
        organization_id,
    }))
}

fn bot_claim_header(
    headers: &HeaderMap,
    name: &'static str,
) -> Result<Option<String>, MacroAuthorizationRejection> {
    headers
        .get(name)
        .map(|header| {
            header
                .to_str()
                .map(str::to_owned)
                .map_err(|_| invalid_bot_claims_rejection())
        })
        .transpose()
}

fn invalid_bot_claims_rejection() -> MacroAuthorizationRejection {
    status_rejection(StatusCode::BAD_REQUEST, "invalid bot claims")
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

fn authorization_rejection(error: Report<MacroAuthorizationError>) -> MacroAuthorizationRejection {
    let message = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired => "jwt expired",
        MacroAuthorizationError::InvalidCredentials
        | MacroAuthorizationError::ActingUserNotAuthorized
        | MacroAuthorizationError::Unavailable => "unauthorized",
    };
    tracing::error!(error=?error, "credential authorization failed");
    rejection(message)
}

fn bot_authorization_rejection(
    error: Report<MacroAuthorizationError>,
) -> MacroAuthorizationRejection {
    let rejection = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired
        | MacroAuthorizationError::InvalidCredentials => rejection("unauthorized"),
        MacroAuthorizationError::ActingUserNotAuthorized => {
            status_rejection(StatusCode::FORBIDDEN, "forbidden")
        }
        MacroAuthorizationError::Unavailable => {
            status_rejection(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        }
    };
    tracing::error!(error=?error, "bot authorization failed");
    rejection
}

fn internal_authorization_rejection(
    error: Report<MacroAuthorizationError>,
) -> MacroAuthorizationRejection {
    tracing::error!(error=?error.current_context(), "internal authorization failed");
    rejection("unauthorized")
}

fn rejection(message: &'static str) -> MacroAuthorizationRejection {
    status_rejection(StatusCode::UNAUTHORIZED, message)
}

fn status_rejection(status: StatusCode, message: &'static str) -> MacroAuthorizationRejection {
    MacroAuthorizationRejection {
        status,
        message: message.into(),
    }
}
