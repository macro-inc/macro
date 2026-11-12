use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::user::claim_handle::{ClaimHandleError, claim_handle};
use macro_user_id::handle::{MailboxHandle, ROX_MAIL_DOMAIN};
use model::response::ErrorResponse;

use crate::api::context::{ApiContext, AuthorizationService};

/// An authenticated request to claim the account's first-party mailbox handle.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct ClaimHandleRequest {
    /// A lowercase handle satisfying the shared Rox mailbox grammar.
    pub handle: String,
}

/// The claimed handle and its first-party address.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClaimHandleResponse {
    /// The canonical handle.
    pub handle: String,
    /// `handle@rox.one`.
    pub address: String,
}

/// Claims a handle once for this account. Existing usernames are unchanged
/// until this endpoint is called; a taken handle is never replaced with a suffix.
#[utoipa::path(
    put,
    path = "/user/handle",
    operation_id = "claim_handle",
    request_body = ClaimHandleRequest,
    responses(
        (status = 200, body = ClaimHandleResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(request): Json<ClaimHandleRequest>,
) -> Result<Response, Response> {
    let handle = MailboxHandle::parse(&request.handle).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "invalid or reserved handle".into(),
            }),
        )
            .into_response()
    })?;
    claim_handle(
        &ctx.db,
        &authorization.authorization.user.user_context.fusion_user_id,
        &handle,
    )
    .await
    .map_err(|error| match error {
        ClaimHandleError::InvalidIdentity => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: error.to_string().into(),
            }),
        )
            .into_response(),
        ClaimHandleError::Taken | ClaimHandleError::AlreadyClaimed => (
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                message: error.to_string().into(),
            }),
        )
            .into_response(),
        ClaimHandleError::Database(error) => {
            tracing::error!(?error, "unable to claim mailbox handle");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to claim handle".into(),
                }),
            )
                .into_response()
        }
    })?;

    Ok(Json(ClaimHandleResponse {
        address: format!("{}@{ROX_MAIL_DOMAIN}", handle.as_str()),
        handle: handle.into_string(),
    })
    .into_response())
}
