//! Axum router for harness registration and device-code pairing.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
};
use harness_id::HarnessId;
use macro_authorization::{
    AccountHolderOrInternal, HarnessOnly, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, UserOnly, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::Serialize;
use uuid::Uuid;

use crate::domain::{
    models::{
        ApprovePairingRequest, ClaimOutcome, ClaimPairingRequest, ClaimedPairing,
        CreatePairingRequest, CreatedPairing, Harness, HarnessAgent, HarnessCapabilities,
        HarnessResident, HarnessSession, PairingDetails, PatchHarnessRequest,
        RUNTIME_CONNECTED_HEADER, SetHarnessTeamAccessRequest,
    },
    ports::{HarnessError, HarnessService},
};

#[cfg(test)]
mod test;

/// State for the harnesses router.
pub struct HarnessesRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for HarnessesRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: HarnessService, Auth> HarnessesRouterState<S, Auth> {
    /// Create a router state.
    pub fn new(service: S, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service: Arc::new(service),
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<HarnessesRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &HarnessesRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Pairing code path.
#[derive(Debug, serde::Deserialize)]
pub struct PairingCodePath {
    /// Pairing code as the user typed it.
    pub code: String,
}

/// Pairing id path.
#[derive(Debug, serde::Deserialize)]
pub struct PairingIdPath {
    /// Pairing id.
    pub pairing_id: Uuid,
}

/// Harness path.
#[derive(Debug, serde::Deserialize)]
pub struct HarnessPath {
    /// Harness id.
    pub harness_id: HarnessId,
}

/// Create a harnesses router.
pub fn harnesses_router<S, Auth, T>(state: HarnessesRouterState<S, Auth>) -> Router<T>
where
    S: HarnessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route("/harness-pairings", post(create_pairing_handler::<S, Auth>))
        .route(
            "/harness-pairings/{code}",
            get(get_pairing_handler::<S, Auth>),
        )
        .route(
            "/harness-pairings/{code}/approve",
            post(approve_pairing_handler::<S, Auth>),
        )
        .route(
            "/harness-pairings/{pairing_id}/claim",
            post(claim_pairing_handler::<S, Auth>),
        )
        .route("/harnesses", get(list_harnesses_handler::<S, Auth>))
        .route(
            "/harnesses/directory",
            get(list_directory_handler::<S, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/team-access",
            put(set_team_access_handler::<S, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/residents",
            get(list_residents_handler::<S, Auth>),
        )
        .route("/harnesses/me", get(get_self_harness_handler::<S, Auth>))
        .route(
            "/harnesses/me",
            delete(delete_self_harness_handler::<S, Auth>),
        )
        .route(
            "/harnesses/me/agents",
            get(list_bound_agents_handler::<S, Auth>),
        )
        .route(
            "/harnesses/me/sessions",
            get(list_harness_sessions_handler::<S, Auth>),
        )
        .route(
            "/harnesses/me/capabilities",
            put(put_self_capabilities_handler::<S, Auth>),
        )
        .route(
            "/harnesses/{harness_id}",
            delete(delete_harness_handler::<S, Auth>)
                .merge(patch(patch_harness_handler::<S, Auth>)),
        )
        .with_state(state)
}

/// Body returned while a claim is still waiting for approval.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PendingClaimResponse {
    /// Always `pending`.
    pub status: &'static str,
}

/// Handler for `POST /harness-pairings`.
///
/// Unauthenticated by design: the daemon has no credential yet - obtaining one
/// is the point. The pairing releases nothing until a signed-in user approves
/// it, and creation is throttled in the domain service.
#[utoipa::path(
    post,
    tag = "harnesses",
    operation_id = "create_harness_pairing",
    path = "/harness-pairings",
    request_body = CreatePairingRequest,
    responses(
        (status = 201, body = CreatedPairing),
        (status = 400, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn create_pairing_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    Json(req): Json<CreatePairingRequest>,
) -> Result<(StatusCode, Json<CreatedPairing>), HarnessesHandlerErr> {
    let pairing = state.service.create_pairing(req).await?;
    Ok((StatusCode::CREATED, Json(pairing)))
}

/// Handler for `GET /harness-pairings/{code}`.
#[utoipa::path(
    get,
    tag = "harnesses",
    operation_id = "get_harness_pairing",
    path = "/harness-pairings/{code}",
    params(("code" = String, Path, description = "Pairing code")),
    responses(
        (status = 200, body = PairingDetails),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 410, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_pairing_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    _authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<PairingCodePath>,
) -> Result<Json<PairingDetails>, HarnessesHandlerErr> {
    Ok(Json(state.service.get_pairing(&path.code).await?))
}

/// Handler for `POST /harness-pairings/{code}/approve`.
#[utoipa::path(
    post,
    tag = "harnesses",
    operation_id = "approve_harness_pairing",
    path = "/harness-pairings/{code}/approve",
    params(("code" = String, Path, description = "Pairing code")),
    request_body = ApprovePairingRequest,
    responses(
        (status = 200, body = Harness),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 410, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn approve_pairing_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    Path(path): Path<PairingCodePath>,
    Json(req): Json<ApprovePairingRequest>,
) -> Result<Json<Harness>, HarnessesHandlerErr> {
    let harness = state
        .service
        .approve_pairing(
            authorization.authorization.user.macro_user_id,
            &path.code,
            req,
        )
        .await?;
    Ok(Json(harness))
}

/// Handler for `POST /harness-pairings/{pairing_id}/claim`.
///
/// Unauthenticated like pairing creation; the device secret minted alongside
/// the pairing is the credential, and the pairing id (not the short user
/// code) addresses it.
#[utoipa::path(
    post,
    tag = "harnesses",
    operation_id = "claim_harness_pairing",
    path = "/harness-pairings/{pairing_id}/claim",
    params(("pairing_id" = Uuid, Path, description = "Pairing ID")),
    request_body = ClaimPairingRequest,
    responses(
        (status = 200, body = ClaimedPairing),
        (status = 202, body = PendingClaimResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 410, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn claim_pairing_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    Path(path): Path<PairingIdPath>,
    Json(req): Json<ClaimPairingRequest>,
) -> Result<Response, HarnessesHandlerErr> {
    match state.service.claim_pairing(path.pairing_id, req).await? {
        ClaimOutcome::Pending => Ok((
            StatusCode::ACCEPTED,
            Json(PendingClaimResponse { status: "pending" }),
        )
            .into_response()),
        ClaimOutcome::Claimed(claimed) => Ok(Json(claimed).into_response()),
    }
}

/// Handler for `GET /harnesses`.
#[utoipa::path(
    get,
    tag = "harnesses",
    operation_id = "list_harnesses",
    path = "/harnesses",
    responses(
        (status = 200, body = Vec<Harness>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_harnesses_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<Harness>>, HarnessesHandlerErr> {
    Ok(Json(
        state
            .service
            .list_harnesses(authorization.authorization.user.macro_user_id)
            .await?,
    ))
}

/// Handler for `PATCH /harnesses/{harness_id}`.
#[utoipa::path(
    patch,
    tag = "harnesses",
    operation_id = "patch_harness",
    path = "/harnesses/{harness_id}",
    params(("harness_id" = HarnessId, Path, description = "Harness ID")),
    request_body = PatchHarnessRequest,
    responses(
        (status = 200, body = Harness),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn patch_harness_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
    Json(req): Json<PatchHarnessRequest>,
) -> Result<Json<Harness>, HarnessesHandlerErr> {
    Ok(Json(
        state
            .service
            .patch_harness(
                authorization.authorization.user.macro_user_id,
                path.harness_id,
                req,
            )
            .await?,
    ))
}

/// Handler for `GET /harnesses/directory`.
#[utoipa::path(
    get,
    tag = "harnesses",
    operation_id = "list_harness_directory",
    path = "/harnesses/directory",
    responses(
        (status = 200, body = Vec<Harness>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_directory_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<Harness>>, HarnessesHandlerErr> {
    Ok(Json(
        state
            .service
            .list_directory(authorization.authorization.user.macro_user_id)
            .await?,
    ))
}

/// Handler for `PUT /harnesses/{harness_id}/team-access`.
///
/// Requires the owner's own session: an agent can ask for access to a runtime
/// but never open one, since that grants code execution on the machine.
#[utoipa::path(
    put,
    tag = "harnesses",
    operation_id = "set_harness_team_access",
    path = "/harnesses/{harness_id}/team-access",
    params(("harness_id" = HarnessId, Path, description = "Harness ID")),
    request_body = SetHarnessTeamAccessRequest,
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn set_team_access_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<HarnessPath>,
    Json(req): Json<SetHarnessTeamAccessRequest>,
) -> Result<StatusCode, HarnessesHandlerErr> {
    if !authorization.authorization.is_human_session() {
        return Err(HarnessError::Unauthorized.into());
    }
    state
        .service
        .set_team_access(
            authorization.authorization.macro_user_id,
            path.harness_id,
            req,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Handler for `GET /harnesses/{harness_id}/residents`.
#[utoipa::path(
    get,
    tag = "harnesses",
    operation_id = "list_harness_residents",
    path = "/harnesses/{harness_id}/residents",
    params(("harness_id" = HarnessId, Path, description = "Harness ID")),
    responses(
        (status = 200, body = Vec<HarnessResident>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_residents_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<Json<Vec<HarnessResident>>, HarnessesHandlerErr> {
    Ok(Json(
        state
            .service
            .list_residents(
                authorization.authorization.user.macro_user_id,
                path.harness_id,
            )
            .await?,
    ))
}

/// Handler for `DELETE /harnesses/{harness_id}`.
#[utoipa::path(
    delete,
    tag = "harnesses",
    operation_id = "delete_harness",
    path = "/harnesses/{harness_id}",
    params(("harness_id" = HarnessId, Path, description = "Harness ID")),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn delete_harness_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<StatusCode, HarnessesHandlerErr> {
    state
        .service
        .delete_harness(
            authorization.authorization.user.macro_user_id,
            path.harness_id,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Handler for `GET /harnesses/me`.
#[utoipa::path(
    get,
    tag = "harnesses",
    operation_id = "get_self_harness",
    path = "/harnesses/me",
    responses(
        (status = 200, body = Harness),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_self_harness_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, HarnessOnly>,
    headers: HeaderMap,
) -> Result<Json<Harness>, HarnessesHandlerErr> {
    let harness = state
        .service
        .get_self(authorization.authorization.harness_id)
        .await?;

    if runtime_presence_disagrees(&headers, &harness) {
        tracing::warn!(
            telemetry_event = "harness_presence_disagreement",
            harness = %harness.id,
            last_connected_at = ?harness.last_connected_at,
            "a daemon holds a runtime connection this harness reads as offline"
        );
    }

    Ok(Json(harness))
}

/// Whether the daemon asking says it holds a connection the harness reads as not
/// having. Only the daemon can see this: the service's own answer is what is wrong.
fn runtime_presence_disagrees(headers: &HeaderMap, harness: &Harness) -> bool {
    headers.contains_key(RUNTIME_CONNECTED_HEADER) && !harness.connected
}

/// Handler for `DELETE /harnesses/me`.
///
/// A daemon retiring itself: the valid credential is the authorization.
#[utoipa::path(
    delete,
    tag = "harnesses",
    operation_id = "delete_self_harness",
    path = "/harnesses/me",
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn delete_self_harness_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, HarnessOnly>,
) -> Result<StatusCode, HarnessesHandlerErr> {
    state
        .service
        .delete_self(authorization.authorization.harness_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Handler for `GET /harnesses/me/sessions`.
#[utoipa::path(
    get,
    tag = "harnesses",
    operation_id = "list_harness_sessions",
    path = "/harnesses/me/sessions",
    responses(
        (status = 200, body = Vec<HarnessSession>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_harness_sessions_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, HarnessOnly>,
) -> Result<Json<Vec<HarnessSession>>, HarnessesHandlerErr> {
    Ok(Json(
        state
            .service
            .list_sessions(authorization.authorization.harness_id)
            .await?,
    ))
}

/// Handler for `GET /harnesses/me/agents`.
#[utoipa::path(
    get,
    tag = "harnesses",
    operation_id = "list_harness_agents",
    path = "/harnesses/me/agents",
    responses(
        (status = 200, body = Vec<HarnessAgent>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_bound_agents_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, HarnessOnly>,
) -> Result<Json<Vec<HarnessAgent>>, HarnessesHandlerErr> {
    Ok(Json(
        state
            .service
            .list_bound_agents(authorization.authorization.harness_id)
            .await?,
    ))
}

/// Handler for `PUT /harnesses/me/capabilities`.
///
/// macrod reports what its machine can do after it connects; the body
/// replaces the previous report.
#[utoipa::path(
    put,
    tag = "harnesses",
    operation_id = "put_self_harness_capabilities",
    path = "/harnesses/me/capabilities",
    request_body = HarnessCapabilities,
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn put_self_capabilities_handler<S: HarnessService, Auth: MacroAuthorizationService>(
    State(state): State<HarnessesRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, HarnessOnly>,
    Json(capabilities): Json<HarnessCapabilities>,
) -> Result<StatusCode, HarnessesHandlerErr> {
    state
        .service
        .report_capabilities(authorization.authorization.harness_id, capabilities)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Harnesses handler error.
#[derive(Debug, thiserror::Error)]
pub enum HarnessesHandlerErr {
    /// Domain error.
    #[error(transparent)]
    Harness(#[from] HarnessError),
}

impl IntoResponse for HarnessesHandlerErr {
    fn into_response(self) -> Response {
        let Self::Harness(error) = &self;
        let status = match error {
            HarnessError::BadRequest(_) => StatusCode::BAD_REQUEST,
            HarnessError::NotFound(_) => StatusCode::NOT_FOUND,
            HarnessError::Gone(_) => StatusCode::GONE,
            HarnessError::Unauthorized => StatusCode::UNAUTHORIZED,
            HarnessError::Throttled => StatusCode::TOO_MANY_REQUESTS,
            HarnessError::Repo(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error=?self, "harnesses handler error");
        }
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}
