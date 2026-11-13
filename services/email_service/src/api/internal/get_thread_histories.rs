use crate::api::{ApiContext, context::AuthorizationService};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::message_reads::SummaryReadError;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use models_email::service::message::ThreadHistoryRequest;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum GetThreadHistoriesError {
    #[error("Link not found for user {0}")]
    LinkNotFound(String),

    #[error("Database query failed")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for GetThreadHistoriesError {
    fn into_response(self) -> Response {
        let status_code = match self {
            GetThreadHistoriesError::LinkNotFound(_) => StatusCode::NOT_FOUND,
            GetThreadHistoriesError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "GetThreadHistoriesError",
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
    Json(req_body): Json<ThreadHistoryRequest>,
) -> Result<Response, GetThreadHistoriesError> {
    let response = ctx
        .message_reads
        .histories(req_body)
        .await
        .map_err(|error| match error {
            SummaryReadError::LinkNotFound(user) => GetThreadHistoriesError::LinkNotFound(user),
            SummaryReadError::Query(error) => {
                GetThreadHistoriesError::QueryError(error.into_inner())
            }
        })?;
    Ok((StatusCode::OK, Json(response)).into_response())
}
