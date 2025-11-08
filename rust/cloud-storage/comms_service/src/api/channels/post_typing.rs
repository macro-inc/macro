use crate::{
    api::{
        context::AppState,
        extractors::{ChannelId, ChannelMember},
    },
    service::sender::notify::{TypingUpdate, notify_typing},
};

use anyhow::Result;
use axum::extract::{Json, State};
use axum::http::StatusCode;
use comms_db_client::model::TypingAction;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostTypingRequest {
    pub action: TypingAction,
    pub thread_id: Option<String>,
}

#[utoipa::path(
        post,
        tag = "channels",
        operation_id = "post_typing",
        path = "/channels/{channel_id}/typing",
        params(
            ("channel_id" = String, Path, description = "id of the channel")
        ),
        responses(
            (status = 201, body=String),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(app_state))]
pub async fn post_typing_handler(
    State(app_state): State<AppState>,
    ChannelMember(channel_member): ChannelMember,
    ChannelId(channel_id): ChannelId,
    Json(req): Json<PostTypingRequest>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let thread_id = req
        .thread_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|err| {
                tracing::error!("unable to parse thread id: {:?}", err);
                (StatusCode::BAD_REQUEST, err.to_string())
            })
        })
        .transpose()?;

    notify_typing(
        &app_state,
        TypingUpdate {
            channel_id,
            user_id: channel_member.context.user_id.clone(),
            action: req.action,
            thread_id,
        },
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to notify message");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to deliver message".to_string(),
        )
    })?;

    Ok((StatusCode::OK, "message sent".to_string()))
}
