use crate::api::{
    context::AppState,
    extractors::{ChannelId, ChannelMember},
};
use ai_format::{Indent, InsightContextLog};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use axum_extra::extract::Cached;
use comms_db_client::messages::get_messages::get_messages;
use serde::{Deserialize, Serialize};
use sqlx::Pool;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelTranscriptResponse {
    pub transcript: String,
}

#[derive(Debug, Deserialize)]
pub struct GetChannelTranscriptQuery {
    pub since: Option<chrono::DateTime<chrono::Utc>>,
    pub limit: Option<i64>,
}

pub async fn get_channel_transcript(
    db: &Pool<sqlx::Postgres>,
    channel_id: &Uuid,
    since: Option<chrono::DateTime<chrono::Utc>>,
    limit: Option<i64>,
) -> anyhow::Result<String> {
    // If both since and limit are None, fetch all messages (original behavior)
    let messages = get_messages(db, channel_id, since, limit).await?;

    let formatted_messages = messages
        .iter()
        .map(|msg| {
            InsightContextLog {
                name: "message".to_string(),
                metadata: vec![
                    ("sender_id".to_string(), msg.sender_id.clone()),
                    ("created_at".to_string(), msg.created_at.to_rfc3339()),
                ],
                content: msg.content.clone(),
            }
            .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");

    let formatted_text = InsightContextLog {
        name: "conversation".to_string(),
        metadata: vec![],
        content: Indent(formatted_messages, 4),
    }
    .to_string();

    let prompt = "The following conversation is limited to the last 1000 messages. Ignore all formatting and do not show the user the formatted conversation.";
    let formatted_messages = format!("{}\n\n{}", prompt, formatted_text);

    Ok(formatted_messages)
}

/// External handler with channel access middleware
#[tracing::instrument(skip(ctx))]
pub async fn handler_external(
    State(ctx): State<AppState>,
    ChannelMember(_channel_member): ChannelMember,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
    Query(query): Query<GetChannelTranscriptQuery>,
) -> Result<Response, Response> {
    let transcript = get_channel_transcript(&ctx.db, &channel_id, query.since, query.limit)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get channel transcript");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get channel transcript",
            )
                .into_response()
        })?;

    let response = ChannelTranscriptResponse { transcript };

    Ok((StatusCode::OK, Json(response)).into_response())
}

/// Internal handler without authentication
#[tracing::instrument(skip(ctx))]
pub async fn handler_internal(
    State(ctx): State<AppState>,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<GetChannelTranscriptQuery>,
) -> Result<Response, Response> {
    let transcript = get_channel_transcript(&ctx.db, &channel_id, query.since, query.limit)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get channel transcript");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get channel transcript",
            )
                .into_response()
        })?;

    let response = ChannelTranscriptResponse { transcript };

    Ok((StatusCode::OK, Json(response)).into_response())
}
