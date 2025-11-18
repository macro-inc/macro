use crate::api::context::ApiContext;
use axum::Extension;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model::response::{EmptyResponse, ErrorResponse};
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum DeleteDraftError {
    #[error("Draft with id {0} not found")]
    NotFound(Uuid),

    #[error("The provided id {0} belongs to a message, not a draft")]
    NotADraft(Uuid),

    #[error("Failed to get draft from database")]
    QueryError(#[from] anyhow::Error),

    #[error("A database transaction error occurred")]
    TransactionError(#[from] sqlx::Error),
}

impl IntoResponse for DeleteDraftError {
    fn into_response(self) -> Response {
        let status_code = match self {
            DeleteDraftError::NotFound(_) => StatusCode::NOT_FOUND,
            DeleteDraftError::NotADraft(_) => StatusCode::BAD_REQUEST,
            DeleteDraftError::QueryError(_) | DeleteDraftError::TransactionError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "DeleteDraftError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
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
            (status = 204),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    ctx: State<ApiContext>,
    link: Extension<Link>,
    Path(draft_id): Path<Uuid>,
) -> Result<Response, DeleteDraftError> {
    let message_replying_to = email_db_client::messages::get_simple_messages::get_simple_message(
        &ctx.db,
        &draft_id,
        &link.fusionauth_user_id,
    )
    .await?
    .ok_or(DeleteDraftError::NotFound(draft_id))?;

    if !message_replying_to.is_draft {
        return Err(DeleteDraftError::NotADraft(draft_id));
    }

    let mut tx = ctx.db.begin().await?;

    let result = email_db_client::messages::delete::delete_message_with_tx(
        &mut tx,
        &message_replying_to,
        false,
    )
    .await;

    match result {
        Ok(_) => {
            tx.commit().await?;
            Ok(StatusCode::NO_CONTENT.into_response())
        }
        Err(e) => {
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(error=?rollback_err, "Failed to rollback transaction after draft delete failure");
            }
            Err(DeleteDraftError::from(e))
        }
    }
}
