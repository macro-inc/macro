//! Realtime Soup patch orchestration.

#[cfg(test)]
mod test;

use std::{collections::HashSet, num::NonZeroUsize, time::Duration};

use broadcast::{BroadcastManager, GlobalSpawner};
use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::prelude::{Report, ResultExt as _};
use tokio::task::JoinHandle;
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use super::{
    models::{Patch, SoupRealtimeMessage, SoupRealtimePatch},
    ports::{
        SoupRealtimeConsumer, SoupRealtimePublisher, SoupRealtimeService,
        SoupRealtimeSubscriptionService, UserAccessExpander,
    },
};

/// Number of messages retained by each user-keyed broadcast channel.
const BROADCAST_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(64).unwrap();
/// Number of messages buffered for each individual subscriber.
const SUBSCRIBER_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(16).unwrap();
/// Total receive attempts before the consumer returns for supervision.
const MAX_RECEIVE_ATTEMPTS: usize = 5;

/// Retries after one, two, four, and eight seconds.
fn receive_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take(MAX_RECEIVE_ATTEMPTS - 1)
}

/// Service for distributing recipient-targeted realtime Soup patches.
pub struct SoupRealtimeConsumerService<C>
where
    C: SoupRealtimeConsumer,
{
    consumer: C,
    broadcasts: BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, Patch<Entity<'static>>>,
}

impl<C> SoupRealtimeConsumerService<C>
where
    C: SoupRealtimeConsumer,
{
    /// Creates a realtime Soup consumer service backed by `consumer`.
    pub fn new(consumer: C) -> Self {
        Self {
            consumer,
            broadcasts: BroadcastManager::new(GlobalSpawner, BROADCAST_BUFFER_CAPACITY),
        }
    }

    /// Subscribes to realtime Soup patches addressed to `user_id`.
    ///
    /// The returned receiver is closed if its buffer fills, ensuring a slow
    /// subscriber cannot delay the shared consumer or other subscribers.
    #[must_use]
    pub fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Patch<Entity<'static>>> {
        self.broadcasts
            .subscribe(user_id, SUBSCRIBER_BUFFER_CAPACITY)
    }

    /// Receives patches and distributes them to subscribers until reception fails.
    ///
    /// Callers should run this future in a supervised task. A patch for a user
    /// without active subscribers is intentionally dropped.
    #[tracing::instrument(skip(self), err)]
    pub async fn run(&self) -> Result<(), Report> {
        loop {
            let SoupRealtimeMessage { user_id, patch } = Retry::start(
                receive_retry_strategy(),
                || self.consumer.recv(),
            )
            .await
            .context(format!(
                "failed to receive realtime Soup patch after {MAX_RECEIVE_ATTEMPTS} attempts"
            ))?;

            match self.broadcasts.publish(&user_id, patch) {
                Ok(subscriber_count) => {
                    tracing::trace!(subscriber_count, "distributed realtime Soup patch")
                }
                Err(_) => tracing::trace!("dropping realtime Soup patch without subscribers"),
            }
        }
    }
}

impl<C> SoupRealtimeSubscriptionService for SoupRealtimeConsumerService<C>
where
    C: SoupRealtimeConsumer,
{
    fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Patch<Entity<'static>>> {
        SoupRealtimeConsumerService::subscribe(self, user_id)
    }
}

/// Maximum number of Kafka publications polled concurrently.
const PUBLISH_CONCURRENCY: usize = 16;

/// Domain service that expands entity access and fans out lightweight patches.
pub struct SoupRealtimeServiceImpl {
    sender: tokio::sync::mpsc::Sender<SoupRealtimePatch>,
    _bg: JoinHandle<()>,
}

struct Worker<A, P> {
    access_expander: A,
    publisher: P,
    rx: tokio::sync::mpsc::Receiver<SoupRealtimePatch>,
}

impl<A: UserAccessExpander, P: SoupRealtimePublisher> Worker<A, P> {
    async fn run(&mut self) -> () {
        while let Some(msg) = self.rx.recv().await {
            let _ = self.process_one(msg).await;
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn process_one(&self, msg: SoupRealtimePatch) -> Result<(), Report> {
        let mut users = self
            .access_expander
            .expand_user_access(&msg.access_source)
            .await
            .context("failed to expand current user access")?;

        let mut seen = HashSet::with_capacity(users.len());
        users.retain(|user_id| seen.insert(user_id.clone()));
        tracing::Span::current().record("recipient_count", users.len());

        let messages = users
            .into_iter()
            .map(|user_id| SoupRealtimeMessage::new(user_id, msg.patch.clone()))
            .collect::<Vec<_>>();
        let results = stream::iter(
            messages
                .into_iter()
                .map(|message| self.publisher.publish(message)),
        )
        .buffer_unordered(PUBLISH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

        let failure_count = results.iter().filter(|result| result.is_err()).count();
        if let Some(error) = results.into_iter().find_map(Result::err) {
            return Err(error
                .context(format!(
                    "{failure_count} realtime Soup publication(s) failed"
                ))
                .into_dynamic());
        }
        Ok(())
    }
}

const BACKGROUND_CHANNEL_SIZE: usize = 256;

impl SoupRealtimeServiceImpl {
    /// Creates a realtime Soup service from its outbound capabilities.
    pub fn new<A: UserAccessExpander, P: SoupRealtimePublisher>(
        access_expander: A,
        publisher: P,
    ) -> Self {
        let (tx, rx) = tokio::sync::mpsc::channel(BACKGROUND_CHANNEL_SIZE);

        let task = tokio::spawn(async move {
            Worker {
                rx,
                access_expander,
                publisher,
            }
            .run()
            .await
        });

        Self {
            sender: tx,
            _bg: task,
        }
    }
}

impl SoupRealtimeService for SoupRealtimeServiceImpl {
    #[tracing::instrument(skip(self), err)]
    fn notify_users(&self, patch: SoupRealtimePatch) -> Result<(), Report> {
        Ok(self.sender.try_send(patch)?)
    }
}
