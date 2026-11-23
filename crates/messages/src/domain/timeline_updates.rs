//! Live channel timeline updates.
//!
//! A committed channel change is hydrated once, by the process that wrote it,
//! into exactly what a changes page returns for its sequence, and published
//! with the participants it is for. Each subscribing process fans the shared
//! value out to its local subscribers from memory: a subscriber costs no
//! database read and no transaction, however many share a channel.

#[cfg(feature = "realtime")]
mod fanout;
#[cfg(test)]
mod test;

#[cfg(feature = "realtime")]
pub use fanout::{ChannelTimelineFanout, ChannelTimelineUpdateSource};

use std::collections::HashSet;

use activity::domain::timeline::TimelineActivity;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    changes::{ChannelMessageChange, load_message_changes},
    delivery::MessageRealtime,
    models::MessageParent,
    ports::{MessageChange, MessageError, MessageEvent, MessageRepository},
};

/// One committed channel change in the state a changes page returns for its
/// sequence: the changed message and, for a reply, its root; or the recorded
/// activity; or the id of an entry that no longer exists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelTimelineUpdate {
    /// Channel whose sequence this change advanced.
    pub channel_id: Uuid,
    /// The channel's position once this change is applied.
    pub seq: i64,
    /// Current changed message and the root of a changed reply.
    pub messages: Vec<ChannelMessageChange>,
    /// Recorded timeline activity.
    pub activities: Vec<TimelineActivity>,
    /// A changed entry that was hard-deleted before it could be read.
    pub removed_ids: Vec<Uuid>,
}

impl ChannelTimelineUpdate {
    /// The update for an activity recorded at `seq`; activities are read from
    /// the committed row, so they need no hydration.
    pub fn activity(channel_id: Uuid, seq: i64, activity: TimelineActivity) -> Self {
        Self {
            channel_id,
            seq,
            messages: Vec::new(),
            activities: vec![activity],
            removed_ids: Vec::new(),
        }
    }
}

/// An update and the users it is for: the channel's participants when the
/// change committed, the same audience as `message_update`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressedChannelTimelineUpdate {
    /// User ids of the participants to deliver to.
    pub recipients: Vec<String>,
    /// The hydrated change.
    pub update: ChannelTimelineUpdate,
}

/// Publishes addressed updates to every process serving subscriptions.
pub trait ChannelTimelineUpdatePublisher: Send + Sync + 'static {
    /// Schedule `update` for delivery; best effort, like `message_update`.
    fn publish(&self, update: &AddressedChannelTimelineUpdate) -> Result<(), rootcause::Report>;
}

/// Reads the current state of changed messages, as a changes page does.
pub trait ChannelMessageChangeLoader: Send + Sync + 'static {
    /// See [`load_message_changes`].
    fn load_message_changes(
        &self,
        channel_id: Uuid,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ChannelMessageChange>, MessageError>> + Send;
}

impl<R: MessageRepository> ChannelMessageChangeLoader for R {
    fn load_message_changes(
        &self,
        channel_id: Uuid,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ChannelMessageChange>, MessageError>> + Send {
        load_message_changes(self, channel_id, ids)
    }
}

/// The users a channel's live updates are for: its active participants, the
/// audience channel message delivery addresses.
pub trait ChannelTimelineAudience: Send + Sync + 'static {
    /// The channel's active participants' user ids.
    fn participants(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, rootcause::Report>> + Send;
}

/// Publishes recorded channel activity as live timeline updates.
pub struct ChannelActivityUpdates<A, P> {
    audience: A,
    publisher: P,
}

impl<A: ChannelTimelineAudience, P: ChannelTimelineUpdatePublisher> ChannelActivityUpdates<A, P> {
    /// Address updates to `audience` and publish them through `publisher`.
    pub fn new(audience: A, publisher: P) -> Self {
        Self {
            audience,
            publisher,
        }
    }

    /// Publish one update per sequenced activity, reading the channel's
    /// participants once for the whole batch. Unsequenced activity is not
    /// part of the change log and is skipped.
    #[tracing::instrument(
        name = "channel_timeline.publish_activity",
        skip_all,
        fields(channel_id = %channel_id, published = tracing::field::Empty),
        err(Debug)
    )]
    pub async fn publish(
        &self,
        channel_id: Uuid,
        activities: impl IntoIterator<Item = (TimelineActivity, Option<i64>)>,
    ) -> Result<(), rootcause::Report> {
        let updates: Vec<_> = activities
            .into_iter()
            .filter_map(|(activity, seq)| {
                Some(ChannelTimelineUpdate::activity(channel_id, seq?, activity))
            })
            .collect();
        tracing::Span::current().record("published", updates.len());
        if updates.is_empty() {
            return Ok(());
        }

        let recipients = self.audience.participants(channel_id).await?;
        let mut first_error = None;
        for update in updates {
            let published = self.publisher.publish(&AddressedChannelTimelineUpdate {
                recipients: recipients.clone(),
                update,
            });
            if let Err(error) = published {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

/// Channel realtime delivery that also publishes each sequenced change as a
/// live timeline update to the participants `realtime` sends it to.
#[derive(Clone)]
pub struct ChannelTimelineRealtime<G, L, P> {
    realtime: G,
    changes: L,
    publisher: P,
}

impl<G, L, P> ChannelTimelineRealtime<G, L, P> {
    /// Publish through `publisher` next to `realtime`, reading changed
    /// messages with `changes` from the database the write committed to.
    pub fn new(realtime: G, changes: L, publisher: P) -> Self {
        Self {
            realtime,
            changes,
            publisher,
        }
    }
}

/// The message a sequenced change advanced the channel for. Typing is never
/// sequenced and thread updates belong to entity discussions.
fn changed_message(change: &MessageChange) -> Option<Uuid> {
    match change {
        MessageChange::Posted { message, .. }
        | MessageChange::Edited { message, .. }
        | MessageChange::MessageDeleted { message }
        | MessageChange::ReactionChanged { message, .. }
        | MessageChange::CallRootPosted { message } => Some(message.id),
        MessageChange::ThreadUpdated { .. } | MessageChange::Typing { .. } => None,
    }
}

impl<G: MessageRealtime, L: ChannelMessageChangeLoader, P: ChannelTimelineUpdatePublisher>
    ChannelTimelineRealtime<G, L, P>
{
    /// Hydrate a sequenced channel change once and publish it to `users`.
    #[tracing::instrument(
        name = "channel_timeline.publish",
        skip_all,
        fields(
            channel_id = tracing::field::Empty,
            seq = tracing::field::Empty,
            recipients = users.len(),
            removed = tracing::field::Empty,
        ),
        err(Debug)
    )]
    async fn publish_update(
        &self,
        event: &MessageEvent,
        users: HashSet<String>,
    ) -> Result<(), rootcause::Report> {
        let (MessageParent::Channel(channel_id), Some(seq)) = (&event.parent, event.seq) else {
            return Ok(());
        };
        let Some(message_id) = changed_message(&event.change) else {
            return Ok(());
        };
        let span = tracing::Span::current();
        span.record("channel_id", tracing::field::display(channel_id));
        span.record("seq", seq);

        let messages = self
            .changes
            .load_message_changes(*channel_id, &[message_id])
            .await
            .map_err(|error| rootcause::report!("channel timeline update read failed: {error}"))?;

        // As in a changes page, an id the read no longer finds was hard-deleted.
        let removed_ids = if messages.iter().any(|change| change.id() == message_id) {
            Vec::new()
        } else {
            vec![message_id]
        };
        span.record("removed", !removed_ids.is_empty());

        self.publisher.publish(&AddressedChannelTimelineUpdate {
            recipients: users.into_iter().collect(),
            update: ChannelTimelineUpdate {
                channel_id: *channel_id,
                seq,
                messages,
                activities: Vec::new(),
                removed_ids,
            },
        })
    }
}

impl<G: MessageRealtime, L: ChannelMessageChangeLoader, P: ChannelTimelineUpdatePublisher>
    MessageRealtime for ChannelTimelineRealtime<G, L, P>
{
    async fn subscribers(
        &self,
        parent: &MessageParent,
    ) -> Result<HashSet<String>, rootcause::Report> {
        self.realtime.subscribers(parent).await
    }

    /// Both deliveries run even when one fails; the first failure is returned.
    async fn send(
        &self,
        event: &MessageEvent,
        users: HashSet<String>,
    ) -> Result<(), rootcause::Report> {
        let sent = self.realtime.send(event, users.clone()).await;
        let published = self.publish_update(event, users).await;
        sent.and(published)
    }
}
