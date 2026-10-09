use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use email::domain::{models::EmailErr, ports::EmailService};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct DeleteDraftError(#[from] EmailErr);
impl IntoResponse for DeleteDraftError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            EmailErr::Unauthorized => StatusCode::FORBIDDEN,
            EmailErr::MessageAlreadySent(_) | EmailErr::MessageDeliveryConflict(_) => {
                StatusCode::CONFLICT
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Delete a draft.
#[utoipa::path(
    delete,
    tag = "Drafts",
    path = "/email/drafts/{id}",
    operation_id = "delete_draft",
    params(
        ("id" = Uuid, Path, description = "Draft ID."),
    ),
    responses(
            (status = 204, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(draft_id): Path<Uuid>,
) -> Result<StatusCode, DeleteDraftError> {
    ctx.email_service
        .service()
        .delete_draft_for_user(authorization.authorization.user.macro_user_id, draft_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
