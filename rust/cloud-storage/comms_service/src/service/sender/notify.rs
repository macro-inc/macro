use anyhow::Result;
use comms_db_client::model::{Attachment, CountedReaction, Message, TypingAction};
use comms_db_client::participants::get_participants::get_participants;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::context::AppState;

#[derive(Serialize, ToSchema)]
pub struct MessageWithNonce<'a> {
    #[serde(flatten)]
    pub message: &'a Message,
    pub nonce: Option<&'a str>,
}

pub async fn notify_message(
    ctx: &AppState,
    message: MessageWithNonce<'_>,
    participants: &[MacroUserIdStr<'_>],
) -> Result<()> {
    if participants.is_empty() {
        return Ok(());
    }
    ctx.connection_gateway_client
        .batch_send_message(
            "comms_message".to_string(),
            serde_json::to_value(message)?,
            participants
                .iter()
                .map(|p| EntityType::User.with_entity_str(p.as_ref()))
                .collect(),
        )
        .await?;

    Ok(())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TypingUpdate<'a> {
    pub channel_id: &'a Uuid,
    pub user_id: &'a str,
    pub action: TypingAction,
    pub thread_id: Option<&'a Uuid>,
    pub nonce: Option<&'a str>,
}

pub async fn notify_typing(ctx: &AppState, update: TypingUpdate<'_>) -> Result<()> {
    let participants = get_participants(&ctx.db, &update.channel_id).await?;

    ctx.connection_gateway_client
        .batch_send_message(
            "comms_typing".to_string(),
            serde_json::to_value(update)?,
            participants
                .iter()
                .map(|p| EntityType::User.with_entity_str(p.user_id.as_ref()))
                .collect(),
        )
        .await?;

    Ok(())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReactionUpdate<'a> {
    pub channel_id: &'a Uuid,
    pub message_id: &'a Uuid,
    pub reactions: &'a [CountedReaction],
    pub nonce: Option<&'a str>,
}

pub async fn notify_reactions(ctx: &AppState, update: ReactionUpdate<'_>) -> Result<()> {
    let participants = get_participants(&ctx.db, &update.channel_id).await?;

    ctx.connection_gateway_client
        .batch_send_message(
            "comms_reaction".to_string(),
            serde_json::to_value(update)?,
            participants
                .iter()
                .map(|p| EntityType::User.with_entity_str(p.user_id.as_ref()))
                .collect(),
        )
        .await?;

    Ok(())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AttachmentUpdate<'a> {
    pub channel_id: &'a Uuid,
    pub message_id: &'a Uuid,
    pub attachments: &'a [Attachment],
    pub nonce: Option<&'a str>,
}

pub async fn notify_attachments(ctx: &AppState, update: AttachmentUpdate<'_>) -> Result<()> {
    let participants = get_participants(&ctx.db, &update.channel_id).await?;

    ctx.connection_gateway_client
        .batch_send_message(
            "comms_attachment".to_string(),
            serde_json::to_value(update)?,
            participants
                .iter()
                .map(|p| EntityType::User.with_entity_str(p.user_id.as_ref()))
                .collect(),
        )
        .await?;

    Ok(())
}
