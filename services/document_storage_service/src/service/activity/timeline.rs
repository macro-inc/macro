//! Best-effort realtime delivery is isolated from durable activity ingestion.
use activity::domain::timeline::TimelineActivity;
use connection_gateway_client::client::ConnectionGatewayClient;
use futures::StreamExt;
use messages::domain::delivery::{MessageAudienceAccess, MessageRealtime};
use messages::domain::models::MessageParent;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc;

const QUEUE_CAPACITY: usize = 256;
const DELIVERY_CONCURRENCY: usize = 16;

/// One timeline's newly committed activity.
type TimelineActivities = (MessageParent, Vec<TimelineActivityEvent>);

/// Preserve the timeline payload and add the sequence allocated at ingestion.
#[derive(Serialize)]
struct TimelineActivityEvent {
    #[serde(flatten)]
    activity: TimelineActivity,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<i64>,
}

/// Enqueues committed timeline activity; delivery reaches the same audience as
/// live messages on that parent.
pub(crate) struct TimelinePublisher(mpsc::Sender<TimelineActivities>);

impl TimelinePublisher {
    /// Compose a bounded delivery worker for the service's tracked task lifecycle.
    pub(crate) fn new<R: MessageRealtime, A: MessageAudienceAccess>(
        client: ConnectionGatewayClient,
        realtime: R,
        access: A,
    ) -> (Self, impl Future<Output = ()> + Send) {
        let (sender, receiver) = mpsc::channel(QUEUE_CAPACITY);
        (Self(sender), deliver(receiver, client, realtime, access))
    }
}

impl activity::domain::ports::ActivityRealtimePublisher for TimelinePublisher {
    async fn publish_recorded(&self, activities: &[activity::Activity]) {
        self.publish_recorded_with_receipts(activities, &[]).await;
    }

    async fn publish_recorded_with_receipts(
        &self,
        activities: &[activity::Activity],
        receipts: &[activity::domain::ports::ActivityReceipt],
    ) {
        let sequences: HashMap<_, _> = receipts
            .iter()
            .filter_map(|receipt| receipt.seq.map(|seq| (receipt.activity_id, seq)))
            .collect();
        // The messages domain decides which timeline, if any, shows a fact.
        let timeline = activities.iter().filter_map(|event| {
            let parent = messages::domain::ports::timeline_parent(event)?;
            Some((
                parent,
                vec![TimelineActivityEvent {
                    activity: TimelineActivity::from(event),
                    seq: sequences.get(&event.id).copied(),
                }],
            ))
        });
        for (parent, activities) in by_parent(timeline) {
            // Storage must keep progressing even when realtime delivery is unavailable.
            if let Err(error) = self.0.try_send((parent.clone(), activities)) {
                tracing::warn!(
                    ?error,
                    ?parent,
                    "activity persisted but timeline delivery could not be queued"
                );
            }
        }
    }

    /// Purges accompany entity deletion; no timeline remains to update.
    async fn publish_invalidated(&self) {}
}

fn by_parent(
    items: impl IntoIterator<Item = TimelineActivities>,
) -> HashMap<MessageParent, Vec<TimelineActivityEvent>> {
    let mut parents = HashMap::<_, Vec<_>>::new();
    for (parent, activities) in items {
        parents.entry(parent).or_default().extend(activities);
    }
    parents
}

async fn deliver<R: MessageRealtime, A: MessageAudienceAccess>(
    mut receiver: mpsc::Receiver<TimelineActivities>,
    client: ConnectionGatewayClient,
    realtime: R,
    access: A,
) {
    let mut batch = Vec::with_capacity(QUEUE_CAPACITY);
    while receiver.recv_many(&mut batch, QUEUE_CAPACITY).await > 0 {
        futures::stream::iter(by_parent(batch.drain(..)))
            .for_each_concurrent(DELIVERY_CONCURRENCY, |(parent, activities)| {
                deliver_to_viewers(&client, &realtime, &access, parent, activities)
            })
            .await;
    }
}

/// Users watching the parent who can still view it.
async fn viewers<R: MessageRealtime, A: MessageAudienceAccess>(
    realtime: &R,
    access: &A,
    parent: &MessageParent,
) -> Result<HashSet<String>, rootcause::Report> {
    let candidates = realtime.subscribers(parent).await?;
    if candidates.is_empty() {
        return Ok(candidates);
    }
    access.viewers(parent, candidates).await
}

/// Like `message_update`, only users watching the parent who can still view it
/// receive the facts. Anyone else reads them with the timeline.
async fn deliver_to_viewers<R: MessageRealtime, A: MessageAudienceAccess>(
    client: &ConnectionGatewayClient,
    realtime: &R,
    access: &A,
    parent: MessageParent,
    activities: Vec<TimelineActivityEvent>,
) {
    let viewers = match viewers(realtime, access, &parent).await {
        Ok(viewers) if viewers.is_empty() => return,
        Ok(viewers) => viewers,
        Err(error) => {
            tracing::warn!(
                ?error,
                ?parent,
                "failed to resolve timeline activity viewers"
            );
            return;
        }
    };
    let _ = client
        .batch_send_message(
            "timeline_activity".into(),
            serde_json::json!({ "parent": parent, "activities": activities }),
            viewers
                .into_iter()
                .map(|user| model_entity::EntityType::User.with_entity_string(user))
                .collect(),
        )
        .await
        .inspect_err(|error| {
            tracing::warn!(?error, ?parent, "failed to deliver timeline activity");
        });
}

#[cfg(test)]
mod test;
