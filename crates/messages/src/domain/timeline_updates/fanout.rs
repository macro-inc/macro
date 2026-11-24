//! Process-local fan-out of addressed channel timeline updates.

use std::num::NonZeroUsize;

use broadcast::{BroadcastManager, BroadcastSubscription, GlobalSpawner};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::OnceCell;

use super::{AddressedChannelTimelineUpdate, ChannelTimelineUpdate};

/// Updates retained by each user's shared broadcast channel.
const BROADCAST_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(128).unwrap();
/// Updates buffered for each subscriber; a streaming agent reply sequences
/// every edit, so this absorbs bursts before a subscriber counts as slow.
const SUBSCRIBER_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(128).unwrap();

/// Opens the source of updates, when its topic can be read.
pub trait ChannelTimelineUpdates: Send + Sync + 'static {
    /// The opened source.
    type Source: ChannelTimelineUpdateSource;
    /// Why the source could not be opened.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Open the source. It receives updates published from now on.
    fn open(&self) -> impl Future<Output = Result<Self::Source, Self::Err>> + Send;
}

/// Receives every addressed update published after it was opened.
pub trait ChannelTimelineUpdateSource: Send + Sync + 'static {
    /// Why no further update can be received.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Waits for the next update and the span its processing belongs to,
    /// parented to the trace of the write that published it.
    fn recv(
        &self,
    ) -> impl Future<Output = Result<(AddressedChannelTimelineUpdate, tracing::Span), Self::Err>> + Send;
}

/// Why the fan-out stopped.
#[derive(Debug, thiserror::Error)]
pub enum ChannelTimelineFanoutError {
    /// The source could not be opened; nobody can subscribe until it is.
    #[error("failed to open channel timeline updates: {0:?}")]
    Open(rootcause::Report),
    /// The open source failed. It keeps its position, so running again
    /// resumes where it stopped.
    #[error("failed to receive channel timeline updates: {0:?}")]
    Receive(rootcause::Report),
}

/// The updates' source is not open yet, so a subscription would miss changes
/// without knowing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("channel timeline updates are not being received yet")]
pub struct ChannelTimelineNotReceiving;

/// Delivers each received update to its recipients' local subscriptions.
///
/// `project` turns an update into the value subscribers receive. It runs once
/// per update, whatever the number of recipients and subscribers, and every
/// subscriber receives a clone of its result: share it behind an `Arc`.
pub struct ChannelTimelineFanout<U: ChannelTimelineUpdates, T> {
    updates: U,
    /// Opened once and kept for the life of the process: a source
    /// opened again would skip what was published in between.
    source: OnceCell<U::Source>,
    project: fn(ChannelTimelineUpdate) -> T,
    broadcasts: BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, T>,
}

impl<U: ChannelTimelineUpdates, T: Clone + Send + Sync + 'static> ChannelTimelineFanout<U, T> {
    /// Fan `updates` out as `project` makes them, once they are open.
    pub fn new(updates: U, project: fn(ChannelTimelineUpdate) -> T) -> Self {
        Self {
            updates,
            source: OnceCell::new(),
            project,
            broadcasts: BroadcastManager::new(GlobalSpawner, BROADCAST_BUFFER_CAPACITY),
        }
    }

    /// Subscribe to updates addressed to `user_id` from now on. The
    /// subscription ends, with its exit reason, when its buffer fills or it
    /// falls behind, so one slow subscriber delays no one else.
    ///
    /// Refused until updates are being received, so that a subscriber never
    /// takes silence for an up-to-date channel.
    pub fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<BroadcastSubscription<T>, ChannelTimelineNotReceiving> {
        if !self.source.initialized() {
            return Err(ChannelTimelineNotReceiving);
        }
        Ok(self
            .broadcasts
            .subscribe(user_id, SUBSCRIBER_BUFFER_CAPACITY))
    }

    /// Open the source if it is not open yet. Subscriptions are accepted from
    /// then on.
    pub async fn open(&self) -> Result<&U::Source, ChannelTimelineFanoutError> {
        self.source
            .get_or_try_init(|| self.updates.open())
            .await
            .map_err(|error| ChannelTimelineFanoutError::Open(super::report(error)))
    }

    /// [Open](Self::open) the source, then receive and deliver updates until it
    /// fails. Run it in a supervised task that runs it again; updates for users
    /// with no subscriber here are dropped.
    pub async fn run(&self) -> Result<(), ChannelTimelineFanoutError> {
        let source = self.open().await?;
        loop {
            let (addressed, span) = source
                .recv()
                .await
                .map_err(|error| ChannelTimelineFanoutError::Receive(super::report(error)))?;
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
