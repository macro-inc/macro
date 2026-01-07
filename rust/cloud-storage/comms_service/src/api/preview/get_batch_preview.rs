use crate::utils::previews::resolve_previews;
use anyhow::Result;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::{Extension, extract::Json};
use comms_db_client::model::ChannelPreview;
use model::response::{GenericErrorResponse, GenericResponse};
use model::user::UserContext;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetBatchChannelPreviewRequest {
    pub channel_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetBatchChannelPreviewResponse {
    pub previews: Vec<ChannelPreview>,
}

#[tracing::instrument(skip(db, user_context, req), fields(user_id=?user_context.user_id))]
#[utoipa::path(
    post,
    tag = "preview",
    operation_id="get_batch_channel_preview",
    path = "/preview",
    responses(
        (status = 200, body=GetBatchChannelPreviewResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 404, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
pub async fn handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Json(req): Json<GetBatchChannelPreviewRequest>,
) -> Result<(StatusCode, Json<GetBatchChannelPreviewResponse>), Response> {
    let raw_previews = comms_db_client::preview::batch_get_channel_preview(
        &db,
        &req.channel_ids,
        &user_context.user_id,
        user_context.organization_id.map(|org_id| org_id as i64),
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to get channel preview");
        GenericResponse::builder()
            .message("failed to retrive channel previews")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR)
            .into_response()
    })?;

    // TODO: if previews include direct messages or private group chats, generate lookup table
    // somehow
    let previews = resolve_previews(&user_context, raw_previews, None);

    Ok((
        StatusCode::OK,
        Json(GetBatchChannelPreviewResponse { previews }),
    ))
}
