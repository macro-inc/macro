//! HTTP endpoint for stopping an in-flight AI chat stream.
//!
//! The request fires the `CancellationToken` registered when the stream
//! started. The streaming task notices, breaks out of its loop, persists
//! whatever the user has already seen, and emits `StreamEnd` over the
//! durable stream.

use crate::api::context::ApiContext;
use crate::api::stream::util::chat_permissions;
use axum::Json;
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use std::fmt;
use utoipa::ToSchema;

/// Request body for stopping an in-flight chat stream.
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone)]
pub struct StopChatStreamRequest {
    /// The chat the stream belongs to. Used to verify the caller has
    /// permission to stop the stream.
    pub chat_id: String,
    /// The stream/message ID to stop.
    pub stream_id: String,
}

/// Response from a stop request.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StopChatStreamResponse {
    /// `true` if a matching in-flight stream was found and cancellation was
    /// triggered, `false` if the stream had already finished or was unknown.
    pub stopped: bool,
}

/// Error response for the stop endpoint.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StopChatStreamError {
    /// Human-readable error message.
    pub error: String,
}

impl fmt::Display for StopChatStreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.error)
    }
}

impl IntoResponse for StopChatStreamError {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::FORBIDDEN, Json(self)).into_response()
    }
}

/// Stop an in-flight AI chat stream.
///
/// Cancels the streaming task associated with the given `stream_id`, causing
/// it to persist whatever has been generated so far and emit `StreamEnd`.
/// The caller must have at least `Edit` access to the chat.
#[utoipa::path(
    post,
    path = "/stream/chat/message/stop",
    request_body = StopChatStreamRequest,
    responses(
        (status = 200, description = "Stop signal sent (or stream already finished)", body = StopChatStreamResponse),
        (status = 403, description = "Forbidden", body = StopChatStreamError),
    )
)]
#[tracing::instrument(skip(state, user_context), fields(chat_id = %request.chat_id, stream_id = %request.stream_id, user_id = %user_context.user_id), err)]
pub async fn stop_chat_stream(
    State(state): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<StopChatStreamRequest>,
) -> Result<Json<StopChatStreamResponse>, StopChatStreamError> {
    let access = chat_permissions::chat_access(
        &state,
        &user_context,
        &request.chat_id,
        request.stream_id.clone(),
    )
    .await
    .map_err(|e| StopChatStreamError {
        error: format!("Permission check failed: {e:?}"),
    })?;

    match access {
        AccessLevel::View | AccessLevel::Comment => {
            return Err(StopChatStreamError {
                error: "Insufficient permissions to stop chat stream".to_string(),
            });
        }
        _ => (),
    }

    // Publish over Redis pub/sub — reaches whichever DCS instance is running
    // the stream. `received` is the subscriber count (0 if the stream already
    // finished or the running instance is gone).
    let received = state
        .ai_stream_registry
        .cancel(&request.stream_id)
        .await
        .map_err(|e| StopChatStreamError {
            error: format!("failed to publish cancel: {e:?}"),
        })?;
    Ok(Json(StopChatStreamResponse {
        stopped: received > 0,
    }))
}
