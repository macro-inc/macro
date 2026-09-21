//! Best-effort realtime delivery is isolated from durable activity ingestion.
use connection_gateway_client::client::ConnectionGatewayClient;
use futures::StreamExt;
use std::collections::HashSet;
use tokio::sync::mpsc;

const QUEUE_CAPACITY: usize = 256;
const DELIVERY_CONCURRENCY: usize = 16;

/// Enqueues invalidation identifiers only; message reads recheck parent access.
pub(crate) struct TimelineObserver(mpsc::Sender<String>);

impl TimelineObserver {
    /// Compose a bounded delivery worker for the service's tracked task lifecycle.
    pub(crate) fn new(client: ConnectionGatewayClient) -> (Self, impl Future<Output = ()> + Send) {
        let (sender, receiver) = mpsc::channel(QUEUE_CAPACITY);
        (Self(sender), deliver(receiver, client))
    }
}

impl activity::domain::ports::ActivityObserver for TimelineObserver {
    fn persisted<'a>(
        &'a self,
        activities: &'a [activity::Activity],
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            let channels: HashSet<_> = activities
                .iter()
                .filter(|event| {
                    event.entity_type == activity::EntityType::Channel
                        && messages::domain::ports::CHANNEL_TIMELINE_ACTIONS
                            .contains(&event.action.to_columns().0)
                })
                .map(|event| event.entity_id.as_str())
                .collect();
            for id in channels {
                // Storage must keep progressing even when realtime delivery is unavailable.
                if let Err(error) = self.0.try_send(id.to_owned()) {
                    tracing::warn!(
                        ?error,
                        channel_id = id,
                        "activity persisted but timeline invalidation could not be queued"
                    );
                }
            }
        })
    }
}

async fn deliver(mut receiver: mpsc::Receiver<String>, client: ConnectionGatewayClient) {
    let mut batch = Vec::with_capacity(QUEUE_CAPACITY);
    while receiver.recv_many(&mut batch, QUEUE_CAPACITY).await > 0 {
        let channels: HashSet<_> = batch.drain(..).collect();
        futures::stream::iter(channels)
            .for_each_concurrent(DELIVERY_CONCURRENCY, |id| {
                let client = &client;
                async move {
                    let _ = client
                        .send_message(
                            model_entity::EntityType::Channel.with_entity_str(&id),
                            "timeline_activity_updated".into(),
                            serde_json::json!({ "type": "channel", "id": id }),
                        )
                        .await
                        .inspect_err(|error| {
                            tracing::warn!(?error, "failed to refresh activity timeline");
                        });
                }
            })
            .await;
    }
}

#[cfg(test)]
mod test;
