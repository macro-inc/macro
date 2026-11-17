use crate::api::{ApiContext, context::AuthorizationService};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::message_reads::SummaryReadError;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use models_email::service::message::MessageSendersRequest;
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
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(req_body): Json<MessageSendersRequest>,
) -> Result<Response, GetMessageSendersError> {
    let response = ctx
        .message_reads
        .senders(req_body)
        .await
        .map_err(|error| match error {
            SummaryReadError::LinkNotFound(user) => GetMessageSendersError::LinkNotFound(user),
            SummaryReadError::Query(error) => {
                GetMessageSendersError::QueryError(error.into_inner())
            }
        })?;
    Ok((StatusCode::OK, Json(response)).into_response())
}
