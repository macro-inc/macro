use anyhow::Result;
use axum::extract::Json;
use axum::{Extension, extract::State};
use comms_db_client::{
    activity::upsert_activity::upsert_activity,
    model::{Activity, ActivityType},
};
use model::user::UserContext;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostActivityRequest {
    pub channel_id: String,
    pub activity_type: ActivityType,
}

#[tracing::instrument(skip(db, user_context), fields(user_id = user_context.user_id))]
#[utoipa::path(
        post,
        tag = "activity",
        operation_id = "post_activity",
        path = "/activity",
        responses(
            (status = 200, body=Activity),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
pub async fn post_activity_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    req: Json<PostActivityRequest>,
) -> Result<(StatusCode, Json<Activity>), (StatusCode, String)> {
    let channel_id = Uuid::parse_str(&req.channel_id).map_err(|err| {
        tracing::error!("unable to parse channel id: {:?}", err);
        (StatusCode::BAD_REQUEST, err.to_string())
    })?;

    let activity = upsert_activity(&db, &user_context.user_id, &channel_id, &req.activity_type)
        .await
        .map_err(|err| {
            tracing::error!("unable to upsert activity: {:?}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    Ok((StatusCode::OK, Json(activity)))
}
