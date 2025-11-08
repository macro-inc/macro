use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use serde::Deserialize;

use crate::api::context::ApiContext;

#[derive(Deserialize)]
pub struct Param {
    pub user_id: String,
}

/// Deletes all notifications for a user
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Path(Param { user_id }): extract::Path<Param>,
) -> Result<Response, Response> {
    notification_db_client::user_notification::delete::delete_all_users_notification(
        &ctx.db, &user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to delete user notifications");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to delete user notifications",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, "ok").into_response())
}
