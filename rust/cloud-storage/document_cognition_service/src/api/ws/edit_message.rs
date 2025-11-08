use crate::{
    api::{context::ApiContext, utils::search},
    model::ws::{FromWebSocketMessage, SendChatMessagePayload, StreamWebSocketError},
    service::get_chat::get_chat,
};

use macro_db_client::dcs::delete_chat_message::delete_chat_message;

use super::chat_message::handle_send_chat_message;
use super::connection::ws_send;
use ai::types::Role;
use anyhow::Result;
use std::sync::Arc;
use tokio;
use tokio::sync::mpsc::UnboundedSender;

#[tracing::instrument(skip(ctx, sender, jwt_token, incoming_message))]
pub async fn handle_edit_last_user_message(
    ctx: Arc<ApiContext>,
    sender: &UnboundedSender<FromWebSocketMessage>,
    incoming_message: SendChatMessagePayload,
    user_id: &str,
    connection_id: &str,
    jwt_token: &str,
) -> Result<(), StreamWebSocketError> {
    let chat = get_chat(&ctx, &incoming_message.chat_id, user_id)
        .await
        .map_err(|err| {
            tracing::error!(
                chat_id = %incoming_message.chat_id,
                user_id,
                error = %err,
                "failed to get chat"
            );
            StreamWebSocketError::FailedToEditMessage {
                reason: "internal error".to_string(),
                stream_id: incoming_message.stream_id.clone(),
            }
        })?;
    let message_id = macro_uuid::generate_uuid_v7().to_string();

    let edited_message = chat
        .messages
        .iter()
        .rev()
        .take(2)
        .find(|message| message.role == Role::User);

    // check that message is valid
    // currently only the last user message can be edited
    if edited_message.is_none() {
        return Err(StreamWebSocketError::FailedToEditMessage {
            reason: "Message could not be found or is not supported".to_string(),
            stream_id: incoming_message.stream_id.clone(),
        });
    }

    ws_send(
        sender,
        FromWebSocketMessage::ChatMessageAck {
            message_id: message_id.clone(),
            chat_id: incoming_message.chat_id.clone(),
        },
    );

    // delete last messages and message after if it exists
    let mut last = chat.messages.iter().rev().take(2).collect::<Vec<_>>();
    last.reverse();
    let mut tsx = ctx.db.begin().await.map_err(|err| {
        tracing::error!(
            chat_id = %incoming_message.chat_id,
            user_id,
            error = %err,
            "error creating transaction"
        );
        StreamWebSocketError::FailedToEditMessage {
            reason: "internal error".to_string(),
            stream_id: incoming_message.stream_id.clone(),
        }
    })?;

    if let Some(first) = last.first()
        && first.role == Role::User
    {
        delete_chat_message(&mut *tsx, &first.id)
            .await
            .map_err(|err| {
                tracing::error!(
                    chat_id = %incoming_message.chat_id,
                    message_id = %first.id,
                    user_id,
                    error = %err,
                    "failed to delete message (i)"
                );
                StreamWebSocketError::FailedToEditMessage {
                    reason: "internal error".to_string(),
                    stream_id: incoming_message.stream_id.clone(),
                }
            })?;
        search::send_remove_chat_message_to_search(&ctx, &chat.id, &first.id);
    }

    if let Some(last) = last.last() {
        delete_chat_message(&mut *tsx, &last.id)
            .await
            .map_err(|err| {
                tracing::error!(
                    chat_id = %incoming_message.chat_id,
                    message_id = %last.id,
                    user_id,
                    error = %err,
                    "failed to delete message (ii)"
                );
                StreamWebSocketError::FailedToEditMessage {
                    reason: "internal error".to_string(),
                    stream_id: incoming_message.stream_id.clone(),
                }
            })?;
        search::send_remove_chat_message_to_search(&ctx, &chat.id, &last.id);
    }

    tsx.commit().await.map_err(|err| {
        tracing::error!(
            chat_id = %incoming_message.chat_id,
            user_id,
            error = %err,
            "error committing transaction"
        );
        StreamWebSocketError::FailedToEditMessage {
            reason: "internal error".to_string(),
            stream_id: incoming_message.stream_id.clone(),
        }
    })?;

    handle_send_chat_message(
        sender,
        ctx,
        message_id,
        incoming_message,
        user_id,
        connection_id,
        jwt_token,
    )
    .await
}
