//! Handle sending StreamEvent to a user
//! Note: StreamEvents are not the same as StreamItems.
//!       StreamEvents are notifcations about the state of a stream
//!       while StreamItems represent stream data itself

use anyhow::Result;
use tokio::sync::mpsc::Sender;

use crate::model::{
    connection::ConnectionContext, message::OutgoingMessage, websocket::StreamEvents,
};

#[tracing::instrument(err, skip(context, sender))]
pub async fn handle_stream_events(
    context: ConnectionContext<'_>,
    sender: &Sender<OutgoingMessage>,
    incoming_message: StreamEvents,
) -> Result<()> {
    let repo = context.api_context.stream_manager.repo();
    let mut rx = repo.notify().await;
    let mut connection_heartbeat = tokio::time::interval(std::time::Duration::from_secs(60));

    loop {
        tokio::select! {
            result = rx.recv() => {
                let Ok(event) = result else {
                    tracing::warn!("notifier exited");
                    break
                };
                if event.id().entity_id != incoming_message.entity.entity_id {
                    continue;
                }
                let Ok(message) = event.try_into().inspect_err(|e| {
                    tracing::error!(error=?e, "failed to serialize stream event message");
                }) else {
                    continue;
                };
                if sender.send(OutgoingMessage::Message(message)).await.is_err() {
                    break;
                };
            }
            _ = connection_heartbeat.tick() => {
                if sender.send(OutgoingMessage::Pong).await.is_err() {
                    break;
                }
            }
        }
    }

    Ok(())
}
