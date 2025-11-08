use axum::extract::Json;
use axum::http::StatusCode;
use axum::{Extension, extract::State};
use model::user::UserContext;

use crate::api::context::AppState;
use comms_db_client::{activity::get_activity::get_activities, model::Activity};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetActivityResponse {
    pub items: Vec<Activity>,
}

#[tracing::instrument(skip(app_state, user_context), fields(user_id = user_context.user_id))]
#[utoipa::path(get,
    tag = "activity",
    operation_id = "get_activity",
    path = "/activity", responses(
    (status = 200, body=GetActivityResponse),
    (status = 401, body=String),
    (status = 404, body=String),
    (status = 500, body=String),
))]
pub async fn get_activity_handler(
    app_state: State<AppState>,
    user_context: Extension<UserContext>,
) -> Result<(StatusCode, Json<GetActivityResponse>), (StatusCode, String)> {
    let activities = get_activities(&app_state.db, &user_context.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get activities");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get activities".to_string(),
            )
        })?;

    Ok((
        StatusCode::OK,
        Json(GetActivityResponse { items: activities }),
    ))
}
