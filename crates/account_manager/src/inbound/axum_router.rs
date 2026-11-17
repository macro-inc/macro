//! Axum router for account manager endpoints.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use macro_authorization::{
    AccountHolderOrInternal, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{
        AccountManagerDecision, AccountManagerError, AccountManagerGrant, AccountManagerRole,
    },
    ports::AccountManagerService,
};

/// Router state for account manager endpoints.
pub struct AccountManagerRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for AccountManagerRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> AccountManagerRouterState<S, Auth> {
    /// Create router state from a shared service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<AccountManagerRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AccountManagerRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the account manager router. Every route refuses a manager credential,
/// so a manager can't change who manages the account it acts as.
pub fn account_manager_router<S, Auth, T>(state: AccountManagerRouterState<S, Auth>) -> Router<T>
where
    S: AccountManagerService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            get(list_account_managers_handler::<S, Auth>)
                .post(request_account_manager_handler::<S, Auth>),
        )
        .route(
            "/{id}",
            get(get_account_manager_grant_handler::<S, Auth>)
                .delete(revoke_account_manager_grant_handler::<S, Auth>),
        )
        .route(
            "/{id}/response",
            post(respond_to_account_manager_request_handler::<S, Auth>),
        )
        .route(
            "/{id}/token",
            post(claim_account_manager_token_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Request body for asking for a grant.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestAccountManagerBody {
    /// The other account (`macro|...`).
    #[schema(value_type = String)]
    pub counterparty_id: MacroUserIdStr<'static>,
    /// The side the caller takes.
    pub caller_role: AccountManagerRole,
}

/// Request body for responding to a request.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RespondToAccountManagerRequestBody {
    /// The response.
    pub decision: AccountManagerDecision,
}

/// The managers of the caller's account.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccountManagersList {
    /// Approved and active grants on the caller's account.
    pub grants: Vec<AccountManagerGrant>,
}

/// The credential, returned only by the claim that issued it.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedAccountManagerToken {
    /// The grant, now active.
    pub grant: AccountManagerGrant,
    /// The secret. Shown only once.
    pub token: String,
}

/// Path params addressing a grant.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct AccountManagerGrantParams {
    /// Grant id.
    pub id: Uuid,
}

/// Ask another account for manager access, in your DM with them.
#[utoipa::path(
    post,
    tag = "account-managers",
    operation_id = "request_account_manager",
    path = "/account-managers",
    request_body = RequestAccountManagerBody,
    responses(
        (status = 200, body = AccountManagerGrant),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn request_account_manager_handler<S, Auth>(
    State(state): State<AccountManagerRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    Json(body): Json<RequestAccountManagerBody>,
) -> Result<Json<AccountManagerGrant>, AccountManagerError>
where
    S: AccountManagerService,
    Auth: MacroAuthorizationService,
{
    let grant = state
        .service
        .request(
            &user.authorization.user.macro_user_id,
            &body.counterparty_id,
            body.caller_role,
        )
        .await?;
    Ok(Json(grant))
}

/// List the managers of the caller's account.
#[utoipa::path(
    get,
    tag = "account-managers",
    operation_id = "list_account_managers",
    path = "/account-managers",
    responses(
        (status = 200, body = AccountManagersList),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_account_managers_handler<S, Auth>(
    State(state): State<AccountManagerRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
) -> Result<Json<AccountManagersList>, AccountManagerError>
where
    S: AccountManagerService,
    Auth: MacroAuthorizationService,
{
    let grants = state
        .service
        .list_managers(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(AccountManagersList { grants }))
}

/// Read a grant the caller is part of.
#[utoipa::path(
    get,
    tag = "account-managers",
    operation_id = "get_account_manager_grant",
    path = "/account-managers/{id}",
    params(AccountManagerGrantParams),
    responses(
        (status = 200, body = AccountManagerGrant),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_account_manager_grant_handler<S, Auth>(
    State(state): State<AccountManagerRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    Path(params): Path<AccountManagerGrantParams>,
) -> Result<Json<AccountManagerGrant>, AccountManagerError>
where
    S: AccountManagerService,
    Auth: MacroAuthorizationService,
{
    let grant = state
        .service
        .get(&user.authorization.user.macro_user_id, params.id)
        .await?;
    Ok(Json(grant))
}

/// Approve or decline a request the caller didn't make.
#[utoipa::path(
    post,
    tag = "account-managers",
    operation_id = "respond_to_account_manager_request",
    path = "/account-managers/{id}/response",
    params(AccountManagerGrantParams),
    request_body = RespondToAccountManagerRequestBody,
    responses(
        (status = 200, body = AccountManagerGrant),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn respond_to_account_manager_request_handler<S, Auth>(
    State(state): State<AccountManagerRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    Path(params): Path<AccountManagerGrantParams>,
    Json(body): Json<RespondToAccountManagerRequestBody>,
) -> Result<Json<AccountManagerGrant>, AccountManagerError>
where
    S: AccountManagerService,
    Auth: MacroAuthorizationService,
{
    let grant = state
        .service
        .respond(
            &user.authorization.user.macro_user_id,
            params.id,
            body.decision,
        )
        .await?;
    Ok(Json(grant))
}

/// Issue the credential to the manager. Works once. A POST, so link previews
/// and crawlers can't use it up.
#[utoipa::path(
    post,
    tag = "account-managers",
    operation_id = "claim_account_manager_token",
    path = "/account-managers/{id}/token",
    params(AccountManagerGrantParams),
    responses(
        (status = 200, body = ClaimedAccountManagerToken),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn claim_account_manager_token_handler<S, Auth>(
    State(state): State<AccountManagerRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    Path(params): Path<AccountManagerGrantParams>,
) -> Result<Json<ClaimedAccountManagerToken>, AccountManagerError>
where
    S: AccountManagerService,
    Auth: MacroAuthorizationService,
{
    let claimed = state
        .service
        .claim(&user.authorization.user.macro_user_id, params.id)
        .await?;
    Ok(Json(ClaimedAccountManagerToken {
        grant: claimed.grant,
        token: claimed.key.expose().to_string(),
    }))
}

/// End a grant. Either side may withdraw it.
#[utoipa::path(
    delete,
    tag = "account-managers",
    operation_id = "revoke_account_manager_grant",
    path = "/account-managers/{id}",
    params(AccountManagerGrantParams),
    responses(
        (status = 200, body = AccountManagerGrant),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn revoke_account_manager_grant_handler<S, Auth>(
    State(state): State<AccountManagerRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    Path(params): Path<AccountManagerGrantParams>,
) -> Result<Json<AccountManagerGrant>, AccountManagerError>
where
    S: AccountManagerService,
    Auth: MacroAuthorizationService,
{
    let grant = state
        .service
        .revoke(&user.authorization.user.macro_user_id, params.id)
        .await?;
    Ok(Json(grant))
}

impl IntoResponse for AccountManagerError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            AccountManagerError::NotFound => StatusCode::NOT_FOUND,
            AccountManagerError::Forbidden(_) => StatusCode::FORBIDDEN,
            AccountManagerError::Conflict(_) => StatusCode::CONFLICT,
            AccountManagerError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AccountManagerError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            AccountManagerError::Internal(_) => {
                tracing::error!(error=?self, "account manager internal server error");
                "internal server error".to_string()
            }
            error => error.to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
