use crate::api::ApiContext;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use models_email::service::message::{MessageSendersRequest, MessageSendersResponse};
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum GetMessageSendersError {
    #[error("Link not found for user {0}")]
    LinkNotFound(String),

    #[error("Database query failed")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for GetMessageSendersError {
    fn into_response(self) -> Response {
        let status_code = match self {
            GetMessageSendersError::LinkNotFound(_) => StatusCode::NOT_FOUND,
            GetMessageSendersError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "GetMessageSendersError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Get message history information for search responses
#[tracing::instrument(skip_all)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Json(req_body): Json<MessageSendersRequest>,
) -> Result<Response, GetMessageSendersError> {
    let link = email_db_client::links::get::fetch_link_by_macro_id(&ctx.db, &req_body.user_id)
        .await?
        .ok_or(GetMessageSendersError::LinkNotFound(req_body.user_id))?;

    let sender_map = email_db_client::messages::get::get_message_sender_and_pretty_sender(
        &ctx.db,
        link.id,
        &req_body.message_ids,
    )
    .await?;

    Ok((StatusCode::OK, Json(MessageSendersResponse { sender_map })).into_response())
}
