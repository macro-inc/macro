use anyhow::Result;
use comms_db_client::model::{Attachment, CountedReaction, Message, TypingAction};
use comms_db_client::participants::get_participants::get_participants;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::context::AppState;

/// Generic wrapper that adds an optional nonce to any serializable payload.
/// Used for optimistic update correlation - the nonce is echoed back to the client.
#[derive(Serialize, ToSchema)]
pub struct WithNonce<'a, T: Serialize> {
    #[serde(flatten)]
    pub data: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce: Option<&'a str>,
}

pub async fn notify_message(
    ctx: &AppState,
    message: WithNonce<'_, &Message>,
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
pub struct TypingData<'a> {
    pub channel_id: &'a Uuid,
    pub user_id: &'a str,
    pub action: TypingAction,
    pub thread_id: Option<&'a Uuid>,
}

#[tracing::instrument(skip(ctx, update), err)]
pub async fn notify_typing(ctx: &AppState, update: WithNonce<'_, TypingData<'_>>) -> Result<()> {
    let participants = get_participants(&ctx.db, update.data.channel_id).await?;

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
pub struct ReactionData<'a> {
    pub channel_id: &'a Uuid,
    pub message_id: &'a Uuid,
    pub reactions: &'a [CountedReaction],
}

pub async fn notify_reactions(
    ctx: &AppState,
    update: WithNonce<'_, ReactionData<'_>>,
) -> Result<()> {
    let participants = get_participants(&ctx.db, update.data.channel_id).await?;

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
pub struct AttachmentData<'a> {
    pub channel_id: &'a Uuid,
    pub message_id: &'a Uuid,
    pub attachments: &'a [Attachment],
}

pub async fn notify_attachments(
    ctx: &AppState,
    update: WithNonce<'_, AttachmentData<'_>>,
) -> Result<()> {
    let participants = get_participants(&ctx.db, update.data.channel_id).await?;

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
