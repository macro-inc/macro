use crate::api::ApiContext;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use models_email::service::message::{ThreadHistoryRequest, ThreadHistoryResponse};
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
    Json(req_body): Json<ThreadHistoryRequest>,
) -> Result<Response, GetThreadHistoriesError> {
    let link = email_db_client::links::get::fetch_link_by_macro_id(&ctx.db, &req_body.user_id)
        .await?
        .ok_or(GetThreadHistoriesError::LinkNotFound(req_body.user_id))?;

    let history_map = email_db_client::user_history::get_thread_summary_info(
        &ctx.db,
        link.id,
        &req_body.thread_ids,
    )
    .await?;

    Ok((StatusCode::OK, Json(ThreadHistoryResponse { history_map })).into_response())
}
