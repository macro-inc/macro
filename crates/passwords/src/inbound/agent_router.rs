//! Agent vault routes and the human review routes for agent access. Handlers
//! only extract credentials and raw input; bodies are parsed into `Result`s the
//! service consumes after flag and directory admission, so a disabled feature
//! is `not_found` even for malformed bodies.
use super::router::csrf;
use crate::domain::{
    agent::{
        AccessRequestBody, AgentAccessRequestPage, AgentAccessRequestState, AgentCreateItem,
        AgentError, AgentItemAccess, AgentPatchItem, AgentSearchPage, AgentSetTotp, AgentTotpCode,
        AgentWriteResult, DiscloseRequest, Disclosed, ResolveRequest, RevokeBody, TotpCodeRequest,
        service::{
            AgentCall, AgentVaultService, Requested, SearchQuery, Written, review::ReviewQuery,
        },
    },
    models::{Actor, ItemId, TeamId},
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, FromRef, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header::CACHE_CONTROL},
    middleware::{from_fn, map_response},
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use macro_authorization::{
    CredentialOrigin, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, UserOnly,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::sync::Arc;
use uuid::Uuid;

/// Untrusted wake correlation header.
pub const WAKE_HEADER: &str = "x-macro-agent-session-id";
const BODY_LIMIT: usize = 256 * 1024;

/// Composition-owned agent service and authenticated transport state.
pub struct AgentRouterState<A> {
    /// Agent vault use cases; owns every policy decision.
    pub service: Arc<AgentVaultService>,
    /// Shared Macro credential-validation boundary.
    pub authorization: MacroAuthorizationState<A>,
}
impl<A> Clone for AgentRouterState<A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}
impl<A> FromRef<AgentRouterState<A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &AgentRouterState<A>) -> Self {
        state.authorization.clone()
    }
}

/// Agent routes, nested at `/passwords/agent`.
pub fn agent_router<A: MacroAuthorizationService, T: Send + Sync + 'static>(
    state: AgentRouterState<A>,
) -> Router<T> {
    Router::new()
        .route("/teams/{team}/items", get(search::<A>).post(create::<A>))
        .route("/teams/{team}/items/{item}", patch(update::<A>))
        .route("/teams/{team}/items/{item}/disclose", post(disclose::<A>))
        .route("/teams/{team}/items/{item}/totp/code", post(totp_code::<A>))
        .route("/teams/{team}/items/{item}/totp", put(set_totp::<A>))
        .route(
            "/teams/{team}/items/{item}/access-requests",
            post(request_access::<A>),
        )
        .route(
            "/teams/{team}/items/{item}/access-requests/mine",
            get(my_request::<A>),
        )
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(from_fn(csrf))
        .layer(map_response(no_store))
        .with_state(state)
}

/// Human review routes for agent access, merged into `/passwords`.
pub fn review_router<A: MacroAuthorizationService, T: Send + Sync + 'static>(
    state: AgentRouterState<A>,
) -> Router<T> {
    Router::new()
        .route("/teams/{team}/agent-access-requests", get(pending::<A>))
        .route(
            "/teams/{team}/items/{item}/agent-access-requests/{request}/resolve",
            post(resolve::<A>),
        )
        .route(
            "/teams/{team}/items/{item}/agents/{agent}/revoke",
            post(revoke::<A>),
        )
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(from_fn(csrf))
        .layer(map_response(no_store))
        .with_state(state)
}

/// Mark every response private; replace transport rejections (plain-text 400/422)
/// with the sanitized `invalid_request` body. Typed agent failures pass through.
async fn no_store(mut response: Response) -> Response {
    let typed = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .is_some_and(|value| value == "application/json");
    if !typed
        && matches!(
            response.status(),
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
        )
    {
        response = (
            StatusCode::BAD_REQUEST,
            Json(AgentFailure {
                code: AgentFailureCode::InvalidRequest,
                retry_after_ms: None,
            }),
        )
            .into_response();
    }
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response
}

/// Closed, payload-free failure codes of the agent vault API.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentErrorCode)]
pub enum AgentFailureCode {
    /// Missing, invalid or unsupported credential.
    Unauthorized,
    /// The directory does not admit this agent to the team.
    InvalidAgent,
    /// The wake header is missing or malformed.
    InvalidSessionAttribution,
    /// Feature off, or outside the agent's catalog.
    NotFound,
    /// No current Agent grant.
    NotGranted,
    /// Awaiting approval or review.
    Pending,
    /// The caller lacks the required capability.
    Forbidden,
    /// Invalid body, selector or value.
    InvalidRequest,
    /// Agents cannot disclose or write this item kind.
    UnsupportedKind,
    /// The selected field is empty; not retryable.
    FieldNotSet,
    /// The committed version or revision changed.
    VersionConflict,
    /// Lease contention; retry with bounded backoff.
    VaultBusy,
    /// Too many requests; retry after `retryAfterMs`.
    RateLimited,
    /// A dependency is unavailable or the deadline elapsed.
    VaultUnavailable,
}

/// Sanitized agent vault failure.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentFailure)]
pub struct AgentFailure {
    /// Machine-readable category; never contains request or secret values.
    pub code: AgentFailureCode,
    /// Present only on `rate_limited`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

/// A domain failure mapped to its status and fixed code.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct AgentApiError(AgentError);
impl From<AgentError> for AgentApiError {
    fn from(error: AgentError) -> Self {
        Self(error)
    }
}
struct Unauthorized;
impl IntoResponse for Unauthorized {
    fn into_response(self) -> Response {
        failure(
            StatusCode::UNAUTHORIZED,
            AgentFailureCode::Unauthorized,
            None,
        )
    }
}
fn failure(status: StatusCode, code: AgentFailureCode, retry_after_ms: Option<u64>) -> Response {
    (
        status,
        Json(AgentFailure {
            code,
            retry_after_ms,
        }),
    )
        .into_response()
}
impl IntoResponse for AgentApiError {
    fn into_response(self) -> Response {
        use AgentFailureCode as Code;
        let (status, code, retry) = match self.0 {
            AgentError::NotFound => (StatusCode::NOT_FOUND, Code::NotFound, None),
            AgentError::InvalidAgent => (StatusCode::FORBIDDEN, Code::InvalidAgent, None),
            AgentError::InvalidSessionAttribution => (
                StatusCode::BAD_REQUEST,
                Code::InvalidSessionAttribution,
                None,
            ),
            AgentError::NotGranted => (StatusCode::FORBIDDEN, Code::NotGranted, None),
            AgentError::Pending => (StatusCode::FORBIDDEN, Code::Pending, None),
            AgentError::Forbidden => (StatusCode::FORBIDDEN, Code::Forbidden, None),
            AgentError::Invalid => (StatusCode::BAD_REQUEST, Code::InvalidRequest, None),
            AgentError::UnsupportedKind => (StatusCode::BAD_REQUEST, Code::UnsupportedKind, None),
            AgentError::FieldNotSet => (StatusCode::CONFLICT, Code::FieldNotSet, None),
            AgentError::Conflict => (StatusCode::CONFLICT, Code::VersionConflict, None),
            AgentError::Busy => (StatusCode::CONFLICT, Code::VaultBusy, None),
            AgentError::RateLimited { retry_after_ms } => (
                StatusCode::TOO_MANY_REQUESTS,
                Code::RateLimited,
                Some(retry_after_ms),
            ),
            AgentError::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                Code::VaultUnavailable,
                None,
            ),
        };
        failure(status, code, retry)
    }
}

/// Only the agent's own user API key reaches agent routes.
fn call<A: MacroAuthorizationService>(
    user: MacroAuthorizationExtractor<A, UserOnly>,
    team: Uuid,
    headers: &HeaderMap,
) -> Result<AgentCall, Unauthorized> {
    if user.authorization.origin != CredentialOrigin::UserApiKey {
        return Err(Unauthorized);
    }
    Ok(AgentCall {
        key_user: user.authorization.macro_user_id,
        team: TeamId(team),
        wake: headers
            .get(WAKE_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned),
    })
}

/// Human review routes keep the human v1 session-only rule.
fn human<A: MacroAuthorizationService>(
    user: MacroAuthorizationExtractor<A, UserOnly>,
) -> Result<Actor, AgentApiError> {
    if user.authorization.origin != CredentialOrigin::Session {
        return Err(AgentApiError(AgentError::Forbidden));
    }
    Ok(Actor {
        user_id: user.authorization.macro_user_id,
    })
}

fn body<T: DeserializeOwned>(bytes: &Bytes) -> Result<T, AgentError> {
    serde_json::from_slice(bytes).map_err(|_| AgentError::Invalid)
}

fn respond<T: Serialize>(
    result: Result<T, AgentError>,
    status: StatusCode,
) -> Result<Response, AgentApiError> {
    Ok((status, Json(result?)).into_response())
}

/// Raw search parameters; validated after admission.
#[derive(Deserialize, utoipa::IntoParams)]
pub struct SearchParams {
    /// Metadata search text; never a value search.
    pub q: Option<String>,
    /// Page size, 1 to 100; default 50.
    pub limit: Option<String>,
    /// Cursor from the previous page.
    pub cursor: Option<String>,
}

/// Raw review page parameters; validated after admission.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ReviewParams {
    /// Managed item: list every agent's access to it instead of the pending queue.
    pub item_id: Option<String>,
    /// Page size, 1 to 100; default 50.
    pub limit: Option<String>,
    /// Cursor from the previous page.
    pub cursor: Option<String>,
}

#[utoipa::path(operation_id = "passwords_agent_search", get, path = "/passwords/agent/teams/{team}/items", params(("team" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7"), SearchParams), responses((status = 200, body = AgentSearchPage), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Search the agent's catalog: metadata and current access only.
pub async fn search<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    headers: HeaderMap,
    Query(params): Query<SearchParams>,
) -> Result<Response, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    let query = SearchQuery::parse(params.q, params.limit, params.cursor);
    respond(state.service.search(call, query).await, StatusCode::OK)
        .map_err(IntoResponse::into_response)
}

#[utoipa::path(operation_id = "passwords_agent_disclose", post, path = "/passwords/agent/teams/{team}/items/{item}/disclose", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7"), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = DiscloseRequest, responses((status = 200, body = Disclosed), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 409, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Disclose one selected field to the agent's capability.
pub async fn disclose<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    let result = state
        .service
        .disclose(call, ItemId(item), body(&bytes))
        .await;
    respond(result, StatusCode::OK).map_err(IntoResponse::into_response)
}

#[utoipa::path(operation_id = "passwords_agent_totp_code", post, path = "/passwords/agent/teams/{team}/items/{item}/totp/code", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7"), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = TotpCodeRequest, responses((status = 200, body = AgentTotpCode), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 409, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// The current verification code of a login or verification-code item.
pub async fn totp_code<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    let result = state
        .service
        .totp_code(call, ItemId(item), body(&bytes))
        .await;
    respond(result, StatusCode::OK).map_err(IntoResponse::into_response)
}

#[utoipa::path(operation_id = "passwords_agent_create", post, path = "/passwords/agent/teams/{team}/items", params(("team" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7"), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = AgentCreateItem, responses((status = 201, body = AgentWriteResult), (status = 200, description = "Replay of an accepted operation", body = AgentWriteResult), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 409, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Create a login or API item attributed to this agent.
pub async fn create<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    match state.service.create(call, body(&bytes)).await {
        Ok(Written::Created(result)) => Ok((StatusCode::CREATED, Json(result)).into_response()),
        Ok(Written::Replayed(result)) => Ok((StatusCode::OK, Json(result)).into_response()),
        Err(error) => Err(AgentApiError(error).into_response()),
    }
}

#[utoipa::path(operation_id = "passwords_agent_update", patch, path = "/passwords/agent/teams/{team}/items/{item}", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7"), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = AgentPatchItem, responses((status = 200, body = AgentWriteResult), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 409, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Replace supplied fields of a login or API item.
pub async fn update<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    let result = state.service.update(call, ItemId(item), body(&bytes)).await;
    respond(result, StatusCode::OK).map_err(IntoResponse::into_response)
}

#[utoipa::path(operation_id = "passwords_agent_set_totp", put, path = "/passwords/agent/teams/{team}/items/{item}/totp", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7"), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = AgentSetTotp, responses((status = 204), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 409, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Enroll a verification-code seed on an item this agent created.
pub async fn set_totp<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<StatusCode, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    state
        .service
        .set_totp(call, ItemId(item), body(&bytes))
        .await
        .map_err(|error| AgentApiError(error).into_response())?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(operation_id = "passwords_agent_request_access", post, path = "/passwords/agent/teams/{team}/items/{item}/access-requests", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7"), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = AccessRequestBody, responses((status = 202, body = AgentAccessRequestState), (status = 200, description = "Already usable", body = AgentAccessRequestState), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 429, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Ask authorized humans for access to an item.
pub async fn request_access<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    match state
        .service
        .request_access(call, ItemId(item), body(&bytes))
        .await
    {
        Ok(Requested::Usable(state)) => Ok((StatusCode::OK, Json(state)).into_response()),
        Ok(Requested::Pending(state)) => Ok((StatusCode::ACCEPTED, Json(state)).into_response()),
        Err(error) => Err(AgentApiError(error).into_response()),
    }
}

#[utoipa::path(operation_id = "passwords_agent_my_request", get, path = "/passwords/agent/teams/{team}/items/{item}/access-requests/mine", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("X-Macro-Agent-Session-Id" = String, Header, description = "Wake UUIDv7")), responses((status = 200, body = AgentAccessRequestState), (status = 400, body = AgentFailure), (status = 401, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// This agent's own request state for the item.
pub async fn my_request<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let call = call(user, team, &headers).map_err(IntoResponse::into_response)?;
    respond(
        state.service.my_request(call, ItemId(item)).await,
        StatusCode::OK,
    )
    .map_err(IntoResponse::into_response)
}

#[utoipa::path(operation_id = "passwords_agent_access_requests", get, path = "/passwords/teams/{team}/agent-access-requests", params(("team" = Uuid, Path), ReviewParams), responses((status = 200, body = AgentAccessRequestPage), (status = 400, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Pending agent requests on items the caller may manage.
pub async fn pending<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    Query(params): Query<ReviewParams>,
) -> Result<Json<AgentAccessRequestPage>, AgentApiError> {
    let actor = human(user)?;
    let query = ReviewQuery::parse(params.item_id, params.limit, params.cursor);
    Ok(Json(
        state
            .service
            .pending_requests(&actor, TeamId(team), query)
            .await?,
    ))
}

#[utoipa::path(operation_id = "passwords_agent_resolve_request", post, path = "/passwords/teams/{team}/items/{item}/agent-access-requests/{request}/resolve", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("request" = Uuid, Path), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = ResolveRequest, responses((status = 200, body = AgentAccessRequestState), (status = 400, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 409, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Approve or deny a pending agent request.
pub async fn resolve<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item, request)): Path<(Uuid, Uuid, Uuid)>,
    bytes: Bytes,
) -> Result<Json<AgentAccessRequestState>, AgentApiError> {
    let actor = human(user)?;
    Ok(Json(
        state
            .service
            .resolve(&actor, TeamId(team), ItemId(item), request, body(&bytes))
            .await?,
    ))
}

#[utoipa::path(operation_id = "passwords_agent_revoke", post, path = "/passwords/teams/{team}/items/{item}/agents/{agent}/revoke", params(("team" = Uuid, Path), ("item" = Uuid, Path), ("agent" = String, Path), ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")), request_body = RevokeBody, responses((status = 200, body = AgentItemAccess), (status = 400, body = AgentFailure), (status = 403, body = AgentFailure), (status = 404, body = AgentFailure), (status = 409, body = AgentFailure), (status = 503, body = AgentFailure)), tag = "passwords")]
/// Revoke an agent's standing approval, or its grant and approval.
pub async fn revoke<A: MacroAuthorizationService>(
    State(state): State<AgentRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, item, agent)): Path<(Uuid, Uuid, String)>,
    bytes: Bytes,
) -> Result<Json<AgentItemAccess>, AgentApiError> {
    let actor = human(user)?;
    let agent = MacroUserIdStr::parse_from_str(&agent)
        .map(CowLike::into_owned)
        .map_err(|_| AgentError::Invalid);
    Ok(Json(
        state
            .service
            .revoke(&actor, TeamId(team), ItemId(item), agent, body(&bytes))
            .await?,
    ))
}

#[cfg(test)]
mod test;
