//! Best-effort realtime delivery is isolated from durable activity ingestion.
use activity::domain::timeline::TimelineActivity;
use connection_gateway_client::client::ConnectionGatewayClient;
use futures::StreamExt;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use messages::domain::delivery::{MessageAudienceAccess, MessageRealtime};
use messages::domain::models::MessageParent;
use messages::domain::timeline_updates::{
    ChannelActivityUpdates, ChannelTimelineAudience, ChannelTimelineUpdatePublisher,
};
use opentelemetry::trace::TraceContextExt as _;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc;
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

const QUEUE_CAPACITY: usize = 256;
const DELIVERY_CONCURRENCY: usize = 16;

/// One timeline's newly committed activity.
type TimelineActivities = (MessageParent, Vec<TimelineActivityEvent>);

/// Queued activity with the trace context that recorded it, so delivery stays
/// in its trace without holding the recording span open.
type QueuedActivities = (
    MessageParent,
    Vec<TimelineActivityEvent>,
    opentelemetry::Context,
);

/// Preserve the timeline payload and add the sequence allocated at ingestion.
#[derive(Serialize)]
struct TimelineActivityEvent {
    #[serde(flatten)]
    activity: TimelineActivity,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<i64>,
}

/// Enqueues committed timeline activity; delivery reaches the same audience as
/// live messages on that parent, and a channel's sequenced activity is also
/// published as live timeline updates to its participants.
pub(crate) struct TimelinePublisher(mpsc::Sender<QueuedActivities>);

impl TimelinePublisher {
    /// Compose a bounded delivery worker for the service's tracked task lifecycle.
    pub(crate) fn new<R, A, CA, P>(
        client: ConnectionGatewayClient,
        realtime: R,
        access: A,
        channel_updates: ChannelActivityUpdates<CA, P>,
    ) -> (Self, impl Future<Output = ()> + Send)
    where
        R: MessageRealtime,
        A: MessageAudienceAccess,
        CA: ChannelTimelineAudience,
        P: ChannelTimelineUpdatePublisher,
    {
        let (sender, receiver) = mpsc::channel(QUEUE_CAPACITY);
        let delivery = Delivery {
            client,
            realtime,
            access,
            channel_updates,
        };
        (Self(sender), deliver(receiver, delivery))
    }
}

/// Reads a channel's active participants for live timeline updates.
pub(crate) struct ChannelParticipantAudience<R>(pub(crate) R);

/// The channel repository could not read the participants.
#[derive(Debug, thiserror::Error)]
#[error("failed to read channel participants: {0:#}")]
pub(crate) struct ParticipantReadError(anyhow::Error);

impl<R: channels::domain::ports::ChannelRepo> ChannelTimelineAudience
    for ChannelParticipantAudience<R>
{
    type Err = ParticipantReadError;

    async fn participants(
        &self,
        channel_id: uuid::Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        let participants = self
            .0
            .get_participants(channel_id)
            .await
            .map_err(|error| ParticipantReadError(error.into()))?;
        // A stored participant id that does not parse names no subscriber.
        Ok(participants
            .iter()
            .filter_map(|participant| MacroUserIdStr::parse_from_str(&participant.user_id).ok())
            .map(CowLike::into_owned)
            .collect())
    }
}

/// Everything the delivery worker sends through.
struct Delivery<R, A, CA, P> {
    client: ConnectionGatewayClient,
    realtime: R,
    access: A,
    channel_updates: ChannelActivityUpdates<CA, P>,
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
            let queued = (
                parent.clone(),
                activities,
                tracing::Span::current().context(),
            );
            if let Err(error) = self.0.try_send(queued) {
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

async fn deliver<R, A, CA, P>(
    mut receiver: mpsc::Receiver<QueuedActivities>,
    delivery: Delivery<R, A, CA, P>,
) where
    R: MessageRealtime,
    A: MessageAudienceAccess,
    CA: ChannelTimelineAudience,
    P: ChannelTimelineUpdatePublisher,
{
    let delivery = &delivery;
    let mut batch = Vec::with_capacity(QUEUE_CAPACITY);
    while receiver.recv_many(&mut batch, QUEUE_CAPACITY).await > 0 {
        futures::stream::iter(by_parent_with_origins(batch.drain(..)))
            .for_each_concurrent(DELIVERY_CONCURRENCY, |(parent, activities, span)| {
                deliver_parent(delivery, parent, activities).instrument(span)
            })
            .await;
    }
}

/// Groups queued activity by parent, opening each group's delivery span in the
/// trace that recorded its first activity and linking the traces of the rest.
fn by_parent_with_origins(
    queued: impl IntoIterator<Item = QueuedActivities>,
) -> Vec<(MessageParent, Vec<TimelineActivityEvent>, tracing::Span)> {
    let mut parents = HashMap::<_, (Vec<_>, Vec<opentelemetry::Context>)>::new();
    for (parent, activities, origin) in queued {
        let (events, origins) = parents.entry(parent).or_default();
        events.extend(activities);
        origins.push(origin);
    }
    parents
        .into_iter()
        .map(|(parent, (activities, origins))| {
            let span = tracing::info_span!(
                "timeline_activity.deliver",
                activities = activities.len(),
                origins = origins.len()
            );
            let mut origins = origins.into_iter();
            if let Some(first) = origins.next() {
                let _ = span.set_parent(first);
            }
            for origin in origins {
                span.add_link(origin.span().span_context().clone());
            }
            (parent, activities, span)
        })
        .collect()
}

/// Sends one parent's activity to its watchers and, for a channel, publishes
/// its sequenced activity as live timeline updates; both run concurrently.
async fn deliver_parent<R, A, CA, P>(
    delivery: &Delivery<R, A, CA, P>,
    parent: MessageParent,
    activities: Vec<TimelineActivityEvent>,
) where
    R: MessageRealtime,
    A: MessageAudienceAccess,
    CA: ChannelTimelineAudience,
    P: ChannelTimelineUpdatePublisher,
{
    let live_updates = async {
        if let MessageParent::Channel(channel_id) = parent {
            let sequenced = activities
                .iter()
                .map(|event| (event.activity.clone(), event.seq));
            // Failures are recorded on the publish span.
            let _ = delivery
                .channel_updates
                .publish(channel_id, sequenced)
                .await;
        }
    };
    let watchers = deliver_to_viewers(
        &delivery.client,
        &delivery.realtime,
        &delivery.access,
        parent.clone(),
        &activities,
    );
    futures::join!(live_updates, watchers);
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
    activities: &[TimelineActivityEvent],
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
