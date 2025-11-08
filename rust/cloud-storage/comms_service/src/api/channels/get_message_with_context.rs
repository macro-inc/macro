use crate::api::context::AppState;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use comms_db_client::messages::read_message_with_context::get_messages_with_context;
use model::comms::GetMessageWithContextResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetMessageWithContextParams {
    /// The ID of the message to get context around
    pub message_id: Uuid,
    /// Number of messages to fetch before the target message
    #[serde(default)]
    pub before: i64,
    /// Number of messages to fetch after the target message
    #[serde(default)]
    pub after: i64,
}

#[utoipa::path(
    get,
    path = "/channels/messages/context",
    tag = "channels",
    operation_id = "get_message_with_context",
    params(
        ("message_id" = String, Query, description = "ID of the message to get context around"),
        ("before" = i64, Query, description = "Number of messages to fetch before the target message (defaults to 0)"),
        ("after" = i64, Query, description = "Number of messages to fetch after the target message (defaults to 0)"),
    ),
    responses(
        (status = 200, body = GetMessageWithContextResponse, description = "Successfully retrieved messages with context"),
        (status = 400, body = String, description = "Invalid request parameters"),
        (status = 401, body = String, description = "Unauthorized"),
        (status = 500, body = String, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(app_state))]
pub async fn handler(
    State(app_state): State<AppState>,
    Query(params): Query<GetMessageWithContextParams>,
) -> Result<(StatusCode, Json<GetMessageWithContextResponse>), (StatusCode, String)> {
    tracing::info!(
        message_id = ?params.message_id,
        before = params.before,
        after = params.after,
        "get_message_with_context"
    );

    let ctx = &app_state;

    let db_messages =
        get_messages_with_context(&ctx.db, &params.message_id, params.before, params.after)
            .await
            .map_err(|err| {
                tracing::error!(error = ?err, "unable to get messages with context");
                (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
            })?;

    // Convert from comms_db_client::model::Message to model::comms::Message
    let messages = db_messages
        .into_iter()
        .map(|m| model::comms::Message {
            id: m.id,
            channel_id: m.channel_id,
            thread_id: m.thread_id,
            sender_id: m.sender_id,
            content: m.content,
            created_at: m.created_at,
            updated_at: m.updated_at,
            edited_at: m.edited_at,
            deleted_at: m.deleted_at,
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(GetMessageWithContextResponse { messages }),
    ))
}
