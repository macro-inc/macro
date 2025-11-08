use crate::{
    api::{
        context::AppState,
        extractors::{ChannelParticipants, MessageId, MessageSenderOrAdmin},
    },
    service::{self, sender::notify::notify_message},
};
use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::StatusCode,
};
use comms_db_client::messages::delete_message::delete_message;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DeleteMessageParams {
    pub channel_id: String,
    pub message_id: String,
}

#[utoipa::path(
        delete,
        tag = "channels",
        operation_id = "delete_message",
        path = "/channels/{channel_id}/message/{message_id}",
        params(
            ("channel_id" = String, Path, description = "id of the channel"),
            ("message_id" = String, Path, description = "id of the message")
        ),
        responses(
            (status = 201, body=String),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, participants))]
pub async fn delete_message_handler(
    State(ctx): State<AppState>,
    _message_sender_or_admin: MessageSenderOrAdmin,
    ChannelParticipants(participants): ChannelParticipants,
    MessageId(message_id): MessageId,
    Path(params): Path<DeleteMessageParams>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    tracing::info!("delete_message");

    let message = delete_message(&ctx.db, message_id).await.map_err(|e| {
        tracing::error!(error=?e, "unable to patch message");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to patch message".to_string(),
        )
    })?;
    let participants: Vec<_> = participants
        .clone()
        .iter()
        .map(|p| p.user_id.clone())
        .collect();

    notify_message(&ctx, message, &participants)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to notify message");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to deliver message".to_string(),
            )
        })?;

    service::search::send_remove_channel_message_to_search_extractor_queue(
        &ctx.sqs_client,
        params.channel_id,
        Some(params.message_id),
    );

    Ok((StatusCode::OK, "message sent".to_string()))
}
