//! Handle sending StreamEvent to a user
//! Note: StreamEvents are not the same as StreamItems.
//!       StreamEvents are notifcations about the state of a stream
//!       while StreamItems represent stream data itself

use stream::domain::{StreamEvent, StreamId};
use tokio::sync::mpsc::Sender;

use crate::model::{
    connection::ConnectionContext, message::OutgoingMessage, websocket::StreamEvents,
};

#[tracing::instrument(skip(context, sender))]
pub fn handle_stream_events(
    context: ConnectionContext<'_>,
    sender: Sender<OutgoingMessage>,
    incoming_message: StreamEvents,
) {
    let repo = context.api_context.stream_manager.repo();

    tokio::spawn(async move {
        // if any prexisting streams exist emit open entity
        if let Ok(streams) = repo
            .active_streams(&incoming_message.entity.entity_id)
            .await
            && !streams.is_empty()
        {
            let stream_event = StreamEvent::Created(StreamId {
                entity_id: incoming_message.entity.entity_id.clone().into(),
                entity_type: incoming_message.entity.entity_type,
                stream_id: streams[0].stream_id.clone(),
            });

            if let Ok(message) = stream_event.try_into()
                && sender
                    .send(OutgoingMessage::Message(message))
                    .await
                    .is_err()
            {
                return;
            }
        }
        let mut connection_heartbeat = tokio::time::interval(std::time::Duration::from_secs(60));
        let mut rx = repo.notify().await;
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
    });
}
