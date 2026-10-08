//! Best-effort realtime delivery is isolated from durable activity ingestion.
use activity::domain::timeline::TimelineActivity;
use channels::domain::ports::ChannelRepo;
use connection_gateway_client::client::ConnectionGatewayClient;
use futures::StreamExt;
use messages::domain::models::MessageParent;
use std::collections::HashMap;
use tokio::sync::mpsc;
use uuid::Uuid;

const QUEUE_CAPACITY: usize = 256;
const DELIVERY_CONCURRENCY: usize = 16;

/// One channel's newly committed timeline activity.
type ChannelActivities = (Uuid, Vec<TimelineActivity>);

/// Enqueues committed channel activity; delivery resolves the channel's participants.
pub(crate) struct ChannelTimelinePublisher(mpsc::Sender<ChannelActivities>);

impl ChannelTimelinePublisher {
    /// Compose a bounded delivery worker for the service's tracked task lifecycle.
    pub(crate) fn new<R: ChannelRepo>(
        client: ConnectionGatewayClient,
        channels: R,
    ) -> (Self, impl Future<Output = ()> + Send) {
        let (sender, receiver) = mpsc::channel(QUEUE_CAPACITY);
        (Self(sender), deliver(receiver, client, channels))
    }
}

impl activity::domain::ports::ActivityRealtimePublisher for ChannelTimelinePublisher {
    async fn publish_recorded(&self, activities: &[activity::Activity]) {
        // The messages domain decides which timeline shows a fact. Only
        // channel timelines have participants to deliver to here.
        let timeline = activities.iter().filter_map(|event| {
            match messages::domain::ports::timeline_parent(event)? {
                MessageParent::Channel(channel_id) => {
                    Some((channel_id, vec![TimelineActivity::from(event)]))
                }
                _ => None,
            }
        });
        for (channel_id, activities) in by_channel(timeline) {
            // Storage must keep progressing even when realtime delivery is unavailable.
            if let Err(error) = self.0.try_send((channel_id, activities)) {
                tracing::warn!(
                    ?error,
                    %channel_id,
                    "activity persisted but timeline delivery could not be queued"
                );
            }
        }
    }

    /// Purges accompany entity deletion; no channel timeline remains to update.
    async fn publish_invalidated(&self) {}
}

fn by_channel(
    items: impl IntoIterator<Item = ChannelActivities>,
) -> HashMap<Uuid, Vec<TimelineActivity>> {
    let mut channels = HashMap::<_, Vec<_>>::new();
    for (channel_id, activities) in items {
        channels.entry(channel_id).or_default().extend(activities);
    }
    channels
}

async fn deliver<R: ChannelRepo>(
    mut receiver: mpsc::Receiver<ChannelActivities>,
    client: ConnectionGatewayClient,
    channels: R,
) {
    let mut batch = Vec::with_capacity(QUEUE_CAPACITY);
    while receiver.recv_many(&mut batch, QUEUE_CAPACITY).await > 0 {
        futures::stream::iter(by_channel(batch.drain(..)))
            .for_each_concurrent(DELIVERY_CONCURRENCY, |(channel_id, activities)| {
                deliver_to_participants(&client, &channels, channel_id, activities)
            })
            .await;
    }
}

/// Only participants receive activity, since it names who joined, left, or renamed.
/// The payload names the timeline's parent so clients file it like a message.
async fn deliver_to_participants<R: ChannelRepo>(
    client: &ConnectionGatewayClient,
    channels: &R,
    channel_id: Uuid,
    activities: Vec<TimelineActivity>,
) {
    let participants = match channels.get_participants(channel_id).await {
        Ok(participants) => participants,
        Err(error) => {
            let error: anyhow::Error = error.into();
            tracing::warn!(?error, %channel_id, "failed to read timeline activity recipients");
            return;
        }
    };
    if participants.is_empty() {
        return;
    }
    let _ = client
        .batch_send_message(
            "timeline_activity".into(),
            serde_json::json!({
                "parent": MessageParent::Channel(channel_id),
                "activities": activities,
            }),
            participants
                .iter()
                .map(|participant| {
                    model_entity::EntityType::User.with_entity_str(&participant.user_id)
                })
                .collect(),
        )
        .await
        .inspect_err(|error| {
            tracing::warn!(?error, %channel_id, "failed to deliver timeline activity");
        });
}

#[cfg(test)]
mod test;
