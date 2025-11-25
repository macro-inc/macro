use super::chat_permissions;
use anyhow::Result;
use axum::extract::State;
use axum::{
    extract::{
        Extension,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};
use dashmap::DashMap;
use macro_user_id::user_id::MacroUserId;
use model::{chat::AttachmentType, user::UserContext};
use models_permissions::share_permission::access_level::AccessLevel;
use std::sync::Arc;
use std::sync::LazyLock;
use tokio::sync::mpsc::{self, UnboundedSender, WeakUnboundedSender};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    api::{
        context::ApiContext,
        ws::{
            chat_message::handle_send_chat_message, completion::send_completion_handler,
            edit_message::handle_edit_last_user_message,
            extraction_status::extraction_status_handler, select_model::select_model_handler,
            simple_completion::handle_simple_completion,
        },
    },
    model::ws::{FromWebSocketMessage, StreamError, ToWebSocketMessage, WebSocketError},
};

use super::attachment_permissions::ensure_user_attachment_access;

use futures::{sink::SinkExt, stream::StreamExt};

/// Maps a stream id to a boolean indicating if the message should be aborted
pub static MESSAGE_ABORT_MAP: LazyLock<DashMap<String, bool>> =
    std::sync::LazyLock::new(DashMap::new);

/// Maps a connection id to a websocket sender
pub static CONNECTION_MAP: LazyLock<DashMap<String, WeakUnboundedSender<FromWebSocketMessage>>> =
    std::sync::LazyLock::new(DashMap::new);

#[utoipa::path(
        get,
        path = "/stream",
        responses(
            (status = 200, description="Sucessfully conntect to streaming websocket"),
            (status = 500, body=String, description="Failed to connect to streaming websocket"),
        )
    )]
#[tracing::instrument(skip(ws, state, user_context))]
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_websocket_connection(socket, state, user_context.0))
}

/// Determines if the incoming message is processable
/// [Err(err)] means there was something wrong with the message... ie not supported
/// [Ok(None)] means the message was ok, but there is nothing for us to process
#[tracing::instrument()]
async fn process_incoming_message(
    msg: &Message,
    message_sender: &UnboundedSender<FromWebSocketMessage>,
) -> Result<Option<ToWebSocketMessage>> {
    // Need to make sure we properly handle Control Frames like Close, Ping, Pong
    match msg {
        // Supported will continue to be handled if properly formatted
        Message::Text(text) => {
            // Handle heartbeat ping messages
            if text == "ping" {
                ws_send(message_sender, FromWebSocketMessage::Pong);
                return Ok(None);
            }

            // Existing JSON parsing code...
            match msg.to_owned().try_into() {
                Ok(msg) => Ok(Some(msg)),
                Err(err) => {
                    tracing::error!(error = %err, "failed to parse websocket message");
                    Ok(None)
                }
            }
        }
        // Unsupported message type
        Message::Binary(_) => {
            tracing::error!("unsupported binary websocket message");
            Ok(None)
        }
        // Should break the loop if the connection is closed
        Message::Close(_) => Ok(None),
        // [Message::Ping] and [Message::Pong] are automatically handled by axum
        _ => Ok(None),
    }
}

#[tracing::instrument(skip(socket, ctx, user_context), fields(user_id=?user_context.user_id))]
async fn handle_websocket_connection(
    socket: WebSocket,
    ctx: ApiContext,
    user_context: UserContext,
) {
    tracing::info!(abort_map_size=?MESSAGE_ABORT_MAP.len(), connection_map_size=?CONNECTION_MAP.len(), "new connection");
    let connection_id = Uuid::new_v4().to_string();

    // ws_sender handles sending messages over the websocket
    // ws_receiver handles receiving messages over the websocket
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // message_sender handles sending messages between threads which are forwarded to the websocket
    // message_receiver handles receiving messages between threads which are forwarded to the websocket
    let (message_sender, mut message_receiver) = mpsc::unbounded_channel::<FromWebSocketMessage>();

    // store a WeakUnboundedSender in the map
    // this ensures that the sender is not kept alive by the map
    (*CONNECTION_MAP).insert(connection_id.clone(), message_sender.clone().downgrade());

    let ctx = Arc::new(ctx);
    // Ability to cancel the receiver task from any subtask
    let receiver_cancel_token = CancellationToken::new();
    let cancel_token = receiver_cancel_token.clone();
    let connection_id_clone = connection_id.clone();

    // the sender task listens on messages to the message_receiver, and then
    // forwards them over the ws_sender
    let mut sender_task = tokio::spawn(async move {
        while let Some(message) = message_receiver.recv().await {
            if let Err(err) = ws_sender.send(message.clone().into()).await {
                tracing::error!(message=?message, error=%err, "failed to send websocket message");
            }
        }
    });

    let mut receiver_task = tokio::spawn(async move {
        let cancel_token = cancel_token.clone();

        while let Some(Ok(msg)) = ws_receiver.next().await {
            tracing::debug!("message recieved");
            // kill the task if the connection is closed
            if cancel_token.is_cancelled() {
                continue;
            }

            let incoming_message = match process_incoming_message(&msg, &message_sender).await {
                Ok(Some(msg)) => msg,
                Ok(None) => continue,
                Err(err) => {
                    tracing::error!(error = %err, "failed to process incoming websocket message");
                    continue;
                }
            };
            tracing::debug!("{:#?}", incoming_message);

            let span =
                tracing::span!(tracing::Level::TRACE, "websocket message received", message=?msg);
            let _span_gaurd = span.enter();

            let message_id = Uuid::new_v4().to_string();
            let ctx_clone = ctx.clone();
            let user_context_clone = user_context.clone();
            let message_sender_clone = message_sender.clone();
            let connection_id = connection_id.clone();

            let attachments: Vec<(String, Option<AttachmentType>)> = match incoming_message {
                ToWebSocketMessage::ExtractionStatus(ref extract) => {
                    vec![(extract.attachment_id.clone(), None)]
                }
                ToWebSocketMessage::GetSimpleCompletionStream(ref stream) => {
                    let attachments = stream
                        .content_document_ids
                        .clone()
                        .unwrap_or_else(std::vec::Vec::new)
                        .clone();
                    attachments
                        .iter()
                        .map(|attachment| (attachment.clone(), None))
                        .collect()
                }
                ToWebSocketMessage::SendCompletion(ref completion) => completion
                    .attachment_id
                    .clone()
                    .map(|id| vec![(id, None)])
                    .unwrap_or_else(std::vec::Vec::new),
                _ => vec![],
            };

            if let Err(err) =
                ensure_user_attachment_access(&ctx, user_context.clone(), attachments).await
            {
                ws_send(&message_sender_clone, FromWebSocketMessage::Error(err));
                continue;
            }

            match incoming_message {
                ToWebSocketMessage::SendChatMessage(payload) => {
                    if let Err(e) = check_user_quota(&ctx, &user_context).await {
                        match e {
                            UserQuotaError::InvalidMacroUserId
                            | UserQuotaError::UnableToGetUserPermissions
                            | UserQuotaError::UnableToGetUserQuota => {
                                ws_send(
                                    &message_sender_clone,
                                    FromWebSocketMessage::Error(WebSocketError::StreamError(
                                        StreamError::InternalError {
                                            stream_id: payload.stream_id,
                                        },
                                    )),
                                );
                            }
                            UserQuotaError::ExceededMaxChatMessages => {
                                ws_send(
                                    &message_sender_clone,
                                    FromWebSocketMessage::Error(WebSocketError::StreamError(
                                        StreamError::PaymentRequired {
                                            stream_id: payload.stream_id,
                                        },
                                    )),
                                );
                            }
                        }
                        continue;
                    }

                    let user_id = user_context_clone.user_id.clone();
                    let jwt_token = payload.jwt.token.clone();
                    let cancel_token = cancel_token.clone();
                    tracing::debug!(user_id=?user_id, chat_id=?payload.chat_id, "handling chat message");
                    let ctx = ctx.clone();
                    match chat_permissions::chat_access(
                        &ctx,
                        &user_context,
                        &payload.chat_id,
                        payload.stream_id.clone(),
                    )
                    .await
                    {
                        Err(e) => {
                            ws_send(&message_sender_clone, FromWebSocketMessage::Error(e));
                            continue;
                        }
                        Ok(access) => match access {
                            AccessLevel::View | AccessLevel::Comment => {
                                ws_send(
                                    &message_sender_clone,
                                    FromWebSocketMessage::Error(WebSocketError::StreamError(
                                        StreamError::Unauthorized {
                                            stream_id: payload.stream_id,
                                        },
                                    )),
                                );
                                continue;
                            }
                            _ => (),
                        },
                    };

                    tokio::spawn(async move {
                        tokio::select! {
                            _ = cancel_token.cancelled() => {},
                            result = Box::pin(handle_send_chat_message(
                                &message_sender_clone,
                                ctx,
                                message_id,
                                payload,
                                user_id.as_str(),
                                &connection_id,
                                &jwt_token
                            )) => {
                                if let Err(err) = result {
                                    ws_send(&message_sender_clone, FromWebSocketMessage::Error(err.into()))
                                }
                            }
                        }
                    });
                }
                ToWebSocketMessage::EditChatMessage(payload) => {
                    let user_id: String = user_context_clone.user_id.clone();
                    let jwt_token = payload.jwt.token.clone();
                    tracing::debug!(user_id=?user_id, chat_id=?payload.chat_id, "handling edit message");
                    let ctx = ctx.clone();

                    match chat_permissions::chat_access(
                        &ctx,
                        &user_context,
                        &payload.chat_id,
                        payload.stream_id.clone(),
                    )
                    .await
                    {
                        Err(e) => {
                            ws_send(&message_sender_clone, FromWebSocketMessage::Error(e));
                            continue;
                        }
                        Ok(access) => match access {
                            AccessLevel::View | AccessLevel::Comment => {
                                ws_send(
                                    &message_sender_clone,
                                    FromWebSocketMessage::Error(WebSocketError::StreamError(
                                        StreamError::Unauthorized {
                                            stream_id: payload.stream_id,
                                        },
                                    )),
                                );
                                continue;
                            }
                            _ => (),
                        },
                    };
                    tokio::spawn(async move {
                        let result = handle_edit_last_user_message(
                            ctx,
                            &message_sender_clone,
                            payload,
                            user_id.as_str(),
                            &connection_id,
                            &jwt_token,
                        )
                        .await;
                        if let Err(err) = result {
                            ws_send(
                                &message_sender_clone,
                                FromWebSocketMessage::Error(err.into()),
                            )
                        }
                    });
                }
                ToWebSocketMessage::StopChatMessage(payload) => {
                    // Insert the stream id into the abort map
                    MESSAGE_ABORT_MAP.insert(payload.stream_id.clone(), true);
                }
                ToWebSocketMessage::SelectModelForChat(payload) => {
                    if let Err(err) =
                        select_model_handler(&ctx_clone.db, payload)
                            .await
                            .map_err(|err| WebSocketError::FailedToSelectModel {
                                details: Some(err.to_string()),
                            })
                    {
                        ws_send(&message_sender_clone, FromWebSocketMessage::Error(err));
                    }
                }
                ToWebSocketMessage::ExtractionStatus(payload) => {
                    let attachment_id = payload.attachment_id.clone();
                    if let Err(err) = extraction_status_handler(
                        &message_sender_clone,
                        ctx_clone,
                        &connection_id,
                        payload,
                    )
                    .await
                    .map_err(|_err| WebSocketError::ExtractionStatusFailed { attachment_id })
                    {
                        ws_send(&message_sender_clone, FromWebSocketMessage::Error(err))
                    }
                }
                ToWebSocketMessage::SendCompletion(payload) => {
                    let user_id = &user_context_clone.user_id;
                    if let Err(err) = send_completion_handler(
                        ctx.clone(),
                        &message_sender_clone,
                        &payload,
                        user_id,
                    )
                    .await
                    {
                        ws_send(&message_sender_clone, FromWebSocketMessage::Error(err))
                    }
                }
                ToWebSocketMessage::GetSimpleCompletionStream(payload) => {
                    let user_id = &user_context_clone.user_id;
                    let response = handle_simple_completion(
                        ctx_clone.clone(),
                        &message_sender_clone,
                        &payload,
                        user_id,
                    )
                    .await;
                    if let Err(err) = response {
                        ws_send(&message_sender_clone, FromWebSocketMessage::Error(err));
                    }
                }
            };
        }
    });

    let connection_id = connection_id_clone.clone();

    // If either task finishes, abort the other task
    tokio::select! {
        _ = (&mut sender_task) => {
            receiver_task.abort();
            tracing::trace!("sender task aborted");
            receiver_cancel_token.cancel();
        },
        _ = (&mut receiver_task) => {
            sender_task.abort();
            tracing::trace!("receiver task aborted");
            receiver_cancel_token.cancel();
        },

    };
    CONNECTION_MAP.remove(&connection_id);
}

pub fn ws_send(sender: &UnboundedSender<FromWebSocketMessage>, message: FromWebSocketMessage) {
    if let Err(e) = sender.send(message) {
        tracing::error!(error=%e, "failed to send message to channel");
    }
}

/// Errors that can occur when checking the user quota
#[derive(Debug, thiserror::Error)]
enum UserQuotaError {
    #[error("invalid macro user id")]
    InvalidMacroUserId,
    #[error("failed to get user permissions")]
    UnableToGetUserPermissions,
    #[error("failed to get user quota")]
    UnableToGetUserQuota,
    #[error("exceeded max chat messages")]
    ExceededMaxChatMessages,
}

/// Checks if the user has paid features and if they have not exceeded their max chat messages
#[tracing::instrument(skip(ctx, user_context), ret, err, fields(user_id=?user_context.user_id))]
async fn check_user_quota(
    ctx: &ApiContext,
    user_context: &UserContext,
) -> Result<(), UserQuotaError> {
    let is_paid_user = if let Some(permissions) = user_context.permissions.as_ref() {
        permissions.contains("read:professional_features")
    } else {
        return Err(UserQuotaError::UnableToGetUserPermissions);
    };

    if is_paid_user {
        return Ok(());
    }

    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map(|u| u.lowercase())
        .map_err(|_| UserQuotaError::InvalidMacroUserId)?;

    let user_quota = macro_db_client::user_quota::get_user_quota(&ctx.db, &user_id)
        .await
        .map_err(|_| UserQuotaError::UnableToGetUserQuota)?;

    if user_quota.ai_chat_messages + 1 > user_quota.max_ai_chat_messages.into() {
        Err(UserQuotaError::ExceededMaxChatMessages)
    } else {
        Ok(())
    }
}
