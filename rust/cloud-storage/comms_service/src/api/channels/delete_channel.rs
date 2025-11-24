use crate::{
    api::{
        context::AppState,
        extractors::{ChannelId, ChannelOwner},
    },
    service,
};
use anyhow::Result;
use axum::{extract::State, http::StatusCode};
use comms_db_client::channels::delete_channel::delete_channel;

#[utoipa::path(
        delete,
        tag = "channels",
        operation_id = "delete_channel",
        path = "/channels/{channel_id}",
        params(
            ("channel_id" = String, Path, description = "id of the channel"),
        ),
        responses(
            (status = 204, body=String),
            (status = 400, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn delete_channel_handler(
    State(ctx): State<AppState>,
    ChannelOwner(channel_owner): ChannelOwner,
    ChannelId(channel_id): ChannelId,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    tracing::info!("delete_channel");

    delete_channel(&ctx.db, channel_id, &channel_owner.context.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "error deleting channel");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;

    service::search::send_remove_channel_message_to_search_extractor_queue(
        &ctx.sqs_client,
        channel_id,
        None::<&str>,
    );

    service::search::send_remove_channel_name_to_search_extractor_queue(
        &ctx.sqs_client,
        &channel_id,
    );

    Ok((
        StatusCode::NOT_FOUND,
        "channel successfully deleted".to_string(),
    ))
}
