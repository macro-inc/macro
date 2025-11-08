use crate::api::context::AppState;
use anyhow::Result;
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use comms_db_client::activity::get_activity::get_channel_history_info;
use model::comms::{GetChannelsHistoryRequest, GetChannelsHistoryResponse};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GetChannelsHistoryError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl IntoResponse for GetChannelsHistoryError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            GetChannelsHistoryError::Sqlx(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

/// get channel information for use in search responses
pub async fn handler(
    State(app_state): State<AppState>,
    Json(req): Json<GetChannelsHistoryRequest>,
) -> Result<Json<GetChannelsHistoryResponse>, GetChannelsHistoryError> {
    let channels_history =
        get_channel_history_info(&app_state.db, &req.user_id, &req.channel_ids).await?;

    Ok(Json(GetChannelsHistoryResponse { channels_history }))
}
