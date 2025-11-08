use crate::api::context::AppState;
use crate::api::extractors::{ChannelId, ChannelMember};
use axum::http::StatusCode;
use axum::{Json, extract::State};
use axum_extra::extract::Cached;
use axum_macros::debug_handler;
use comms_db_client::channels::get_mentions_for_channel::get_mentions_for_channel;
use comms_db_client::model::MessageMention;
use sqlx::PgPool;

#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct GetMentionsResponse {
    mentions: Vec<MessageMention>,
}

#[utoipa::path(
        get,
        path = "/channels/{channel_id}/mentions",
        tag = "channels",
        operation_id = "get_mentions_for_channel",
        params(
            ("channel_id" = String, Path, description = "id of the channel")
        ),
        responses(
            (status = 200, body=GetMentionsResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db))]
#[debug_handler(state = AppState)]
pub async fn handler(
    State(db): State<PgPool>,
    ChannelMember(_channel_member): ChannelMember,
    Cached(ChannelId(channel_id)): Cached<ChannelId>,
) -> anyhow::Result<(StatusCode, Json<GetMentionsResponse>), (StatusCode, String)> {
    let mentions = get_mentions_for_channel(&db, &channel_id)
        .await
        .map_err(|err| {
            tracing::error!(error=?err,"unable to get mentions for channel");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    Ok((StatusCode::OK, Json(GetMentionsResponse { mentions })))
}
