//! Realtime Soup orchestration.

#[cfg(test)]
mod test;

use std::{collections::HashSet, num::NonZeroUsize, sync::Arc, time::Duration};

use broadcast::{BroadcastManager, GlobalSpawner};
use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use models_soup::item::SoupItem;
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use super::{
    models::{SoupRealtimeMessage, SoupRealtimeUpdate},
    ports::{
        SoupItemReader, SoupRealtimeConsumer, SoupRealtimePublisher, SoupRealtimeService,
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

/// Service for distributing recipient-targeted realtime Soup messages.
pub struct SoupRealtimeConsumerService<C>
where
    C: SoupRealtimeConsumer,
{
    consumer: C,
    broadcasts: BroadcastManager<GlobalSpawner, MacroUserIdStr<'static>, Arc<SoupItem<()>>>,
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

    /// Subscribes to realtime Soup items addressed to `user_id`.
    ///
    /// The returned receiver is closed if its buffer fills, ensuring a slow
    /// subscriber cannot delay the shared consumer or other subscribers.
    #[must_use]
    pub fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Arc<SoupItem<()>>> {
        self.broadcasts
            .subscribe(user_id, SUBSCRIBER_BUFFER_CAPACITY)
    }

    /// Receives messages and distributes them to subscribers until reception fails.
    ///
    /// Callers should run this future in a supervised task. A message for a user
    /// without active subscribers is intentionally dropped.
    #[tracing::instrument(skip(self), err)]
    pub async fn run(&self) -> Result<(), Report> {
        loop {
            let SoupRealtimeMessage { user_id, item } = Retry::start(
                receive_retry_strategy(),
                || self.consumer.recv(),
            )
            .await
            .context(format!(
                "failed to receive realtime Soup message after {MAX_RECEIVE_ATTEMPTS} attempts"
            ))?;

            match self.broadcasts.publish(&user_id, Arc::new(item)) {
                Ok(subscriber_count) => {
                    tracing::trace!(subscriber_count, "distributed realtime Soup message")
                }
                Err(_) => tracing::trace!("dropping realtime Soup message without subscribers"),
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
    ) -> tokio::sync::mpsc::Receiver<Arc<SoupItem<()>>> {
        SoupRealtimeConsumerService::subscribe(self, user_id)
    }
}

/// Maximum number of Kafka publications polled concurrently.
const PUBLISH_CONCURRENCY: usize = 16;

/// Domain service that expands access, hydrates each user-scoped item, and fans out.
pub struct SoupRealtimeServiceImpl<A, R, P> {
    access_expander: A,
    item_reader: R,
    publisher: P,
}

impl<A, R, P> SoupRealtimeServiceImpl<A, R, P> {
    /// Creates a realtime Soup service from its three outbound capabilities.
    pub fn new(access_expander: A, item_reader: R, publisher: P) -> Self {
        Self {
            access_expander,
            item_reader,
            publisher,
        }
    }
}

impl<A, R, P> SoupRealtimeService for SoupRealtimeServiceImpl<A, R, P>
where
    A: UserAccessExpander,
    R: SoupItemReader,
    P: SoupRealtimePublisher,
{
    #[tracing::instrument(
        skip(self, update),
        fields(
            entity_type = tracing::field::Empty,
            entity_id = tracing::field::Empty,
            access_source_type = tracing::field::Empty,
            access_source_id = tracing::field::Empty,
            recipient_count = tracing::field::Empty,
        ),
        err
    )]
    async fn notify_users(
        &self,
        update: impl Into<SoupRealtimeUpdate> + Send,
    ) -> Result<(), Report> {
        let update = update.into();
        tracing::Span::current()
            .record(
                "entity_type",
                tracing::field::display(update.item.entity_type),
            )
            .record("entity_id", tracing::field::display(&update.item.entity_id))
            .record(
                "access_source_type",
                tracing::field::display(update.access_source.entity_type),
            )
            .record(
                "access_source_id",
                tracing::field::display(&update.access_source.entity_id),
            );
        let mut users = self
            .access_expander
            .expand_user_access(&update.access_source)
            .await
            .context("failed to expand current user access")?;

        let mut seen = HashSet::with_capacity(users.len());
        users.retain(|user_id| seen.insert(user_id.clone()));
        tracing::Span::current().record("recipient_count", users.len());

        if users.is_empty() {
            return Ok(());
        }

        let mut messages = Vec::with_capacity(users.len());
        for user_id in users {
            let item = self
                .item_reader
                .read_for_user(user_id.clone(), &update.item)
                .await
                .context_with(|| format!("failed to hydrate Soup item for accessor {user_id}"))?
                .ok_or_else(|| {
                    rootcause::report!(
                        "Soup item for {} {} was missing for accessor {}",
                        update.item.entity_type,
                        update.item.entity_id,
                        user_id
                    )
                })?;

            let hydrated_entity = item.entity();
            if hydrated_entity != update.item {
                return Err(rootcause::report!(
                    "Soup reader returned {} {} while hydrating {} {} for accessor {}",
                    hydrated_entity.entity_type,
                    hydrated_entity.entity_id,
                    update.item.entity_type,
                    update.item.entity_id,
                    user_id
                ));
            }

            messages.push(SoupRealtimeMessage::new(user_id, item));
        }

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
