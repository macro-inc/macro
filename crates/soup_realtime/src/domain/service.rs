//! Realtime Soup orchestration.

#[cfg(test)]
mod test;

use std::{collections::HashSet, num::NonZeroUsize, sync::Arc, time::Duration};

use broadcast::{BroadcastManager, GlobalSpawner};
use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_soup::item::SoupItem;
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use super::{
    models::SoupRealtimeMessage,
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

/// Domain service that expands access, hydrates one normalized item, and fans out.
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
        skip(self),
        fields(
            entity_type = %entity.entity_type,
            entity_id = %entity.entity_id,
            recipient_count = tracing::field::Empty,
        ),
        err
    )]
    async fn notify_users(&self, entity: Entity<'static>) -> Result<(), Report> {
        let mut users = self
            .access_expander
            .expand_user_access(&entity)
            .await
            .context("failed to expand current user access")?;

        let mut seen = HashSet::with_capacity(users.len());
        users.retain(|user_id| seen.insert(user_id.clone()));
        tracing::Span::current().record("recipient_count", users.len());

        if users.is_empty() {
            return Ok(());
        }

        let hydration_user_id = users[0].clone();
        let item = self
            .item_reader
            .read_for_user(hydration_user_id.clone(), &entity)
            .await
            .context_with(|| {
                format!("failed to hydrate Soup item through accessor {hydration_user_id}")
            })?
            .ok_or_else(|| {
                rootcause::report!(
                    "Soup item for {} {} was missing for accessor {}",
                    entity.entity_type,
                    entity.entity_id,
                    hydration_user_id
                )
            })?;

        let hydrated_entity = item.entity();
        if hydrated_entity != entity {
            return Err(rootcause::report!(
                "Soup reader returned {} {} while hydrating {} {} through accessor {}",
                hydrated_entity.entity_type,
                hydrated_entity.entity_id,
                entity.entity_type,
                entity.entity_id,
                hydration_user_id
            ));
        }

        let SoupItem::Document(mut document) = item else {
            return Err(rootcause::report!(
                "realtime Soup fan-out currently supports document items only"
            ));
        };
        document.viewed_at = None;

        let messages = users
            .into_iter()
            .map(|user_id| SoupRealtimeMessage::new(user_id, SoupItem::Document(document.clone())))
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
