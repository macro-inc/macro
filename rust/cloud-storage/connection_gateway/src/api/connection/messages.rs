use crate::{
    model::{
        connection::ConnectionContext, message::OutgoingMessage, websocket::ToWebsocketMessage,
    },
    service::tracker,
};
use anyhow::{Context, Result};
use axum::extract::ws::{Message, WebSocket};
use futures::{StreamExt, stream::SplitStream};
use model_entity::TrackingData;
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
                handle_message(connection_context, msg, &sender).await?;
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
        sender.send(OutgoingMessage::Pong).await?;
        return Ok(());
    }

    let parsed_message = serde_json::from_str::<ToWebsocketMessage>(&text_message)
        .context("unable to parse message")?;

    match parsed_message {
        ToWebsocketMessage::TrackEntityMessage(message) => {
            tracker::track_entity(
                connection_context,
                TrackingData {
                    entity: message
                        .extra
                        .entity_type
                        .with_entity_str(&message.extra.entity_id)
                        .with_connection_str(connection_context.connection_id)
                        .with_user_str(&connection_context.user_context.user_id),
                    action: message.action,
                },
            )
            .await
            .ok();
        }
    };

    Ok(())
}
