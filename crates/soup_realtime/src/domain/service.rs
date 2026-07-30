//! Realtime Soup patch orchestration.

#[cfg(test)]
mod test;

use std::{collections::HashSet, num::NonZeroUsize, time::Duration};

use broadcast::{BroadcastManager, GlobalSpawner};
use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::prelude::{Report, ResultExt as _};
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
pub struct SoupRealtimeServiceImpl<A, P> {
    access_expander: A,
    publisher: P,
}

impl<A, P> SoupRealtimeServiceImpl<A, P> {
    /// Creates a realtime Soup service from its outbound capabilities.
    pub fn new(access_expander: A, publisher: P) -> Self {
        Self {
            access_expander,
            publisher,
        }
    }
}

impl<A, P> SoupRealtimeService for SoupRealtimeServiceImpl<A, P>
where
    A: UserAccessExpander,
    P: SoupRealtimePublisher,
{
    #[tracing::instrument(
        skip(self),
        fields(
            entity_type = %patch.patch.value().entity_type,
            entity_id = %patch.patch.value().entity_id,
            access_source_type = %patch.access_source.entity_type,
            access_source_id = %patch.access_source.entity_id,
            recipient_count = tracing::field::Empty,
        ),
        err
    )]
    async fn notify_users(&self, patch: SoupRealtimePatch) -> Result<(), Report> {
        let mut users = self
            .access_expander
            .expand_user_access(&patch.access_source)
            .await
            .context("failed to expand current user access")?;

        let mut seen = HashSet::with_capacity(users.len());
        users.retain(|user_id| seen.insert(user_id.clone()));
        tracing::Span::current().record("recipient_count", users.len());

        let messages = users
            .into_iter()
            .map(|user_id| SoupRealtimeMessage::new(user_id, patch.patch.clone()))
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
