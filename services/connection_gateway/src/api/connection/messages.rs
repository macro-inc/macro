use crate::{
    model::{
        connection::ConnectionContext,
        message::OutgoingMessage,
        tracking::{EntityConnectionExt, TrackingData},
        websocket::ToWebsocketMessage,
    },
    service::{stream_event::handle_stream_events, tracker},
};
use anyhow::{Context, Result};
use axum::extract::ws::{Message, WebSocket};
use cowlike::CowLike;
use futures::{StreamExt, stream::SplitStream};
use macro_user_id::user_id::MacroUserIdStr;
use std::error::Error;
use tokio::sync::mpsc::Sender;
use tungstenite::error::{Error as TungsteniteError, ProtocolError};

pub async fn handle_websocket_stream(
    connection_context: ConnectionContext<'_>,
    mut stream: SplitStream<WebSocket>,
    sender: Sender<OutgoingMessage>,
) -> Result<()> {
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(msg) => {
                if let Err(e) = handle_message(connection_context, msg, &sender).await {
                    tracing::error!(error=?e, "error handling message");
                }
            }
            Err(err) => {
                match err
                    .source()
                    .and_then(|e| e.downcast_ref::<TungsteniteError>())
                {
                    // benign disconnect – ignore
                    Some(TungsteniteError::Protocol(
                        ProtocolError::ResetWithoutClosingHandshake,
                    )) => {}
                    Some(e) => {
                        tracing::error!(
                            error = ?e,
                            connection_id = %connection_context.connection_id,
                            user_id       = %connection_context.user_context.user_id,
                            "web-socket closed with tungstenite error",
                        );
                    }
                    None => {
                        tracing::error!(
                            error = ?err,
                            connection_id = %connection_context.connection_id,
                            user_id       = %connection_context.user_context.user_id,
                            "web-socket closed with non-tungstenite error",
                        );
                    }
                }
                break;
            }
        };
    }

    Ok(())
}

const PING_MESSAGE: &str = "ping";

pub async fn handle_message(
    connection_context: ConnectionContext<'_>,
    message: Message,
    sender: &Sender<OutgoingMessage>,
) -> Result<()> {
    let text_message = match message {
        Message::Text(text) => Some(text),
        Message::Close(_) => {
            tracing::debug!("websocket connection closed naturally");
            return Ok(());
        }
        _ => None,
    }
    .context("messages is not text")?;

    // Handle incoming ping messages
    if text_message.trim() == PING_MESSAGE {
        // Refresh last-online timestamp so long-lived connections don't appear offline
        if let Ok(user_id) =
            MacroUserIdStr::parse_from_str(&connection_context.user_context.user_id)
        {
            connection_context
                .api_context
                .last_online_worker
                .record_online(user_id.into_owned());
        }
        sender.send(OutgoingMessage::Pong).await?;
        return Ok(());
    }

    let parsed_message = serde_json::from_str::<ToWebsocketMessage>(&text_message)
        .context("unable to parse message")?;

    match parsed_message {
        ToWebsocketMessage::TrackEntityMessage(message) => {
            let entity_id = message.extra.entity_id.to_string();

            tracker::track_entity(
                sender,
                connection_context,
                TrackingData {
                    entity: message
                        .extra
                        .entity_type
                        .with_entity_str(&entity_id)
                        .with_connection_str(connection_context.connection_id)
                        .with_user_str(&connection_context.user_context.user_id),
                    action: message.action,
                },
            )
            .await
            .ok();
        }
        ToWebsocketMessage::StreamEvents(message) => {
            handle_stream_events(connection_context, sender.clone(), message)
        }
    };

    Ok(())
}
