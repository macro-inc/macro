use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use fusionauth::error::FusionAuthClientError;
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::response::{EmptyResponse, ErrorResponse};

use crate::api::context::ApiContext;

#[derive(serde::Deserialize, Debug)]
pub struct DeleteInboxGrantUserQueryParams {
    /// The dedicated FusionAuth user minted for a shared mailbox.
    pub fusionauth_user_id: String,
}

/// Hard-deletes the dedicated FusionAuth user minted for a shared mailbox, once the
/// mailbox itself has been torn down, so the stub doesn't squat the address forever.
///
/// Refuses to delete an **active** user: relocated mailbox stubs are always deactivated,
/// while real accounts are active, so the state doubles as a guard against a caller bug
/// pointing this at a human's account. Idempotent on an already-deleted user.
#[tracing::instrument(skip(ctx, _valid_access))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _valid_access: ValidInternalKey,
    extract::Query(DeleteInboxGrantUserQueryParams { fusionauth_user_id }): extract::Query<
        DeleteInboxGrantUserQueryParams,
    >,
) -> Result<Response, Response> {
    match ctx.auth_client.get_user_active(&fusionauth_user_id).await {
        Ok(false) => {}
        Ok(true) => {
            tracing::error!(
                %fusionauth_user_id,
                "delete_inbox_grant_user: refusing to delete an active user"
            );
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    message: "user is active; only deactivated mailbox stubs may be deleted".into(),
                }),
            )
                .into_response());
        }
        Err(FusionAuthClientError::UserDoesNotExist) => {
            return Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response());
        }
        Err(e) => {
            tracing::error!(error=?e, "delete_inbox_grant_user: failed to read user state");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to read user state".into(),
                }),
            )
                .into_response());
        }
    }

    match ctx.auth_client.delete_user(&fusionauth_user_id).await {
        // Already gone (possibly deleted between the state check above and here) — the
        // endpoint is idempotent, so treat as success.
        Ok(()) | Err(FusionAuthClientError::UserDoesNotExist) => {}
        Err(e) => {
            tracing::error!(error=?e, "delete_inbox_grant_user: failed to delete user");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to delete user".into(),
                }),
            )
                .into_response());
        }
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
