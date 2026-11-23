//! Process-local fan-out of addressed channel timeline updates.

use std::num::NonZeroUsize;

use broadcast::{BroadcastManager, BroadcastSubscription, GlobalSpawner};
use macro_user_id::{cowlike::CowLike as _, user_id::MacroUserIdStr};

use super::{AddressedChannelTimelineUpdate, ChannelTimelineUpdate};

/// Updates retained by each user's shared broadcast channel.
const BROADCAST_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(128).unwrap();
/// Updates buffered for each subscriber; a streaming agent reply sequences
/// every edit, so this absorbs bursts before a subscriber counts as slow.
const SUBSCRIBER_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(128).unwrap();

/// Receives every addressed update published after this process started.
pub trait ChannelTimelineUpdateSource: Send + Sync + 'static {
    /// Waits for the next update and the span its processing belongs to,
    /// parented to the trace of the write that published it.
    fn recv(
        &self,
    ) -> impl Future<
        Output = Result<(AddressedChannelTimelineUpdate, tracing::Span), rootcause::Report>,
    > + Send;
}

/// Delivers each received update to its recipients' local subscriptions.
///
/// `project` turns an update into the value subscribers receive. It runs once
/// per update, whatever the number of recipients and subscribers, and every
/// subscriber receives a clone of its result: share it behind an `Arc`.
pub struct ChannelTimelineFanout<S, T> {
    source: S,
    project: fn(ChannelTimelineUpdate) -> T,
    broadcasts: BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, T>,
}

impl<S: ChannelTimelineUpdateSource, T: Clone + Send + Sync + 'static> ChannelTimelineFanout<S, T> {
    /// Fan updates from `source` out as `project` makes them.
    pub fn new(source: S, project: fn(ChannelTimelineUpdate) -> T) -> Self {
        Self {
            source,
            project,
            broadcasts: BroadcastManager::new(GlobalSpawner, BROADCAST_BUFFER_CAPACITY),
        }
    }

    /// Subscribe to updates addressed to `user_id` from now on. The
    /// subscription ends, with its exit reason, when its buffer fills or it
    /// falls behind, so one slow subscriber delays no one else.
    #[must_use]
    pub fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> BroadcastSubscription<T> {
        self.broadcasts
            .subscribe(user_id, SUBSCRIBER_BUFFER_CAPACITY)
    }

    /// Receive and deliver updates until the source fails. Run it in a
    /// supervised task; updates for users with no subscriber here are dropped.
    pub async fn run(&self) -> Result<(), rootcause::Report> {
        loop {
            let (addressed, span) = self.source.recv().await?;
            span.in_scope(|| self.deliver(addressed));
        }
    }

    /// Project one update and hand the result to each recipient subscribed here.
    #[tracing::instrument(
        name = "channel_timeline.fan_out",
        skip_all,
        fields(
            channel_id = %addressed.update.channel_id,
            seq = addressed.update.seq,
            recipients = addressed.recipients.len(),
            delivered = tracing::field::Empty,
        )
    )]
    fn deliver(&self, addressed: AddressedChannelTimelineUpdate) {
        let recipients: Vec<_> = addressed
            .recipients
            .iter()
            .filter_map(|recipient| MacroUserIdStr::parse_from_str(recipient).ok())
            .map(|recipient| recipient.into_owned())
            .filter(|recipient| self.broadcasts.subscriber_count(recipient) > 0)
            .collect();
        if recipients.is_empty() {
            tracing::Span::current().record("delivered", 0);
            return;
        }

        let value = (self.project)(addressed.update);
        let delivered: usize = recipients
            .iter()
            .filter_map(|recipient| self.broadcasts.publish(recipient, value.clone()).ok())
            .sum();
        tracing::Span::current().record("delivered", delivered);
    }
}
