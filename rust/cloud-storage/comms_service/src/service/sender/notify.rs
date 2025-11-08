use anyhow::Result;
use comms_db_client::model::{Attachment, CountedReaction, Message, TypingAction};
use comms_db_client::participants::get_participants::get_participants;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::context::AppState;

pub async fn notify_message(
    ctx: &AppState,
    message: Message,
    participants: &[String],
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
                .map(|p| EntityType::User.with_entity_str(p.as_str()))
                .collect(),
        )
        .await?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TypingUpdate {
    pub channel_id: Uuid,
    pub user_id: String,
    pub action: TypingAction,
    pub thread_id: Option<Uuid>,
}

pub async fn notify_typing(ctx: &AppState, update: TypingUpdate) -> Result<()> {
    let participants = get_participants(&ctx.db, &update.channel_id).await?;

    ctx.connection_gateway_client
        .batch_send_message(
            "comms_typing".to_string(),
            serde_json::to_value(update)?,
            participants
                .iter()
                .map(|p| EntityType::User.with_entity_str(&p.user_id))
                .collect(),
        )
        .await?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ReactionUpdate {
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub reactions: Vec<CountedReaction>,
}

pub async fn notify_reactions(ctx: &AppState, update: ReactionUpdate) -> Result<()> {
    let participants = get_participants(&ctx.db, &update.channel_id).await?;

    ctx.connection_gateway_client
        .batch_send_message(
            "comms_reaction".to_string(),
            serde_json::to_value(update)?,
            participants
                .iter()
                .map(|p| EntityType::User.with_entity_str(&p.user_id))
                .collect(),
        )
        .await?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AttachmentUpdate {
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub attachments: Vec<Attachment>,
}

pub async fn notify_attachments(ctx: &AppState, update: AttachmentUpdate) -> Result<()> {
    let participants = get_participants(&ctx.db, &update.channel_id).await?;

    ctx.connection_gateway_client
        .batch_send_message(
            "comms_attachment".to_string(),
            serde_json::to_value(update)?,
            participants
                .iter()
                .map(|p| EntityType::User.with_entity_str(&p.user_id))
                .collect(),
        )
        .await?;

    Ok(())
}
