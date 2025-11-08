use axum::{
    extract::{self, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    api::{
        context::AppState,
        extractors::{ChannelId, ChannelMember},
    },
    service::sender::notify::{ReactionUpdate, notify_reactions},
};

use comms_db_client::{
    activity::upsert_activity::upsert_activity,
    model::ActivityType,
    reactions::{
        add_reaction::add_reaction, get_reactions::get_message_reactions, group_reactions,
        remove_reaction::remove_reaction,
    },
};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub enum ReactionAction {
    Add,
    Remove,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostReactionRequest {
    // the reaction emoji in question
    pub emoji: String,
    // the id of the message that is being reacted to
    pub message_id: String,
    // wether we are adding or removing the reaction
    pub action: ReactionAction,
}

#[utoipa::path(
        post,
        tag = "channels",
        operation_id = "post_reaction",
        path = "/channels/{channel_id}/reaction",
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
#[tracing::instrument(skip(ctx))]
pub async fn post_reaction_handler(
    State(ctx): State<AppState>,
    ChannelMember(channel_member): ChannelMember,
    ChannelId(channel_id): ChannelId,
    extract::Json(req): extract::Json<PostReactionRequest>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let message_id = Uuid::parse_str(&req.message_id).map_err(|err| {
        tracing::error!(error=?err, "unable to parse message id");
        (StatusCode::BAD_REQUEST, err.to_string())
    })?;

    let req = match req.action {
        ReactionAction::Add => {
            add_reaction(
                &ctx.db,
                message_id,
                req.emoji,
                channel_member.context.user_id.clone(),
            )
            .await
        }
        ReactionAction::Remove => {
            remove_reaction(
                &ctx.db,
                message_id,
                req.emoji,
                channel_member.context.user_id.clone(),
            )
            .await
        }
    };

    let reactions = get_message_reactions(&ctx.db, message_id)
        .await
        .map_err(|err| {
            tracing::error!(error=?err, "unable to get reactions");
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
        })?;

    let counted_reactions = group_reactions(reactions);

    req.map_err(|err| {
        tracing::error!(error=?err, "unable to add reaction");
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    })?;

    notify_reactions(
        &ctx,
        ReactionUpdate {
            channel_id,
            message_id,
            reactions: counted_reactions,
        },
    )
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "failed to notify about reaction");
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    })?;

    tokio::spawn(async move {
        upsert_activity(
            &ctx.db,
            &channel_member.context.user_id,
            &channel_id,
            &ActivityType::Interact,
        )
        .await
        .inspect_err(|err| {
            tracing::error!(error=?err, "unable to upsert activity for message");
        })
        .ok();
    });

    Ok((StatusCode::OK, "Reaction added".to_string()))
}
