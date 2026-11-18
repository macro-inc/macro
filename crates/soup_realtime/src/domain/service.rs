//! Realtime Soup patch orchestration.

#[cfg(test)]
mod test;

use std::{
    collections::{HashMap, HashSet},
    num::NonZeroUsize,
    time::Duration,
};

use broadcast::{BroadcastManager, GlobalSpawner};
use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::prelude::{Report, ResultExt as _};
use tokio::{sync::oneshot, task::JoinHandle};
use tokio_retry::{Retry, strategy::ExponentialBackoff};
use tracing::Instrument as _;

use super::{
    models::{Delivery, Patch, SoupRealtimeMessage, SoupRealtimePatch},
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
            .into_receiver()
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
    sender: tokio::sync::mpsc::Sender<PendingBatch>,
    _bg: JoinHandle<()>,
}

struct PendingBatch {
    patches: Vec<SoupRealtimePatch>,
    completed: oneshot::Sender<Result<Delivery, Report>>,
    span: tracing::Span,
}

struct Worker<A, P> {
    access_expander: A,
    publisher: P,
    rx: tokio::sync::mpsc::Receiver<PendingBatch>,
}

impl<A: UserAccessExpander, P: SoupRealtimePublisher> Worker<A, P> {
    async fn run(&mut self) {
        while let Some(pending) = self.rx.recv().await {
            let result = self
                .process_batch(pending.patches)
                .instrument(pending.span)
                .await;
            // A cancelled caller leaves its source event uncommitted for replay.
            let _ = pending.completed.send(result);
        }
    }

    /// Resolves the recipients of every patch in one lookup, then publishes the
    /// patches in order, each to all of its recipients at once.
    #[tracing::instrument(
        err,
        skip_all,
        fields(
            entity_count = patches.len(),
            recipient_set_count = tracing::field::Empty,
            publish_count = tracing::field::Empty,
        )
    )]
    async fn process_batch(&self, patches: Vec<SoupRealtimePatch>) -> Result<Delivery, Report> {
        let mut seen = HashSet::with_capacity(patches.len());
        let access_sources = patches
            .iter()
            .map(|patch| &patch.access_source)
            .filter(|source| seen.insert(*source))
            .cloned()
            .collect::<Vec<_>>();
        let shared_access = self
            .access_expander
            .expand_user_access(&access_sources)
            .await
            .context("failed to expand current user access")?;

        // Entities sharing access point at one deduplicated recipient list.
        let mut recipient_lists = Vec::with_capacity(shared_access.len());
        let mut recipient_list_by_source = HashMap::with_capacity(access_sources.len());
        let mut recipient_sets = HashSet::new();
        for access in shared_access {
            let mut users = access.users;
            users.sort_by(|left, right| left.as_ref().cmp(right.as_ref()));
            users.dedup();
            if !users.is_empty() {
                recipient_sets.insert(users.clone());
            }
            for entity in access.entities {
                recipient_list_by_source.insert(entity, recipient_lists.len());
            }
            recipient_lists.push(users);
        }

        let mut publish_count = 0;
        for patch in patches {
            let users = recipient_list_by_source
                .get(&patch.access_source)
                .and_then(|&index| recipient_lists.get(index))
                .map(Vec::as_slice)
                .unwrap_or_default();
            let messages = users
                .iter()
                .map(|user_id| SoupRealtimeMessage::new(user_id.clone(), patch.patch.clone()))
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
            publish_count += users.len();
        }

        let span = tracing::Span::current();
        span.record("recipient_set_count", recipient_sets.len());
        span.record("publish_count", publish_count);
        Ok(Delivery {
            recipient_sets,
            publish_count,
        })
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
    #[tracing::instrument(skip_all, fields(patch_count = patches.len()), err)]
    async fn notify_users(&self, patches: Vec<SoupRealtimePatch>) -> Result<Delivery, Report> {
        let (completed, result) = oneshot::channel();
        self.sender
            .send(PendingBatch {
                patches,
                completed,
                span: tracing::Span::current(),
            })
            .await
            .context("realtime Soup worker unavailable")?;

        result
            .await
            .context("realtime Soup worker stopped before completing patch")?
    }
}

/// Expand a PR change to source-scoped records and linked sessions. Each item
/// keeps its own access source; PR access never grants access to a session.
pub async fn pull_request_patches(
    sessions: &impl super::ports::PullRequestSessions,
    github_key: &str,
    records: impl IntoIterator<Item = Entity<'static>>,
) -> Result<Vec<SoupRealtimePatch>, Report> {
    let linked = sessions.linked_sessions(github_key).await?;
    let mut seen = HashSet::new();
    Ok(records
        .into_iter()
        .chain(linked)
        .filter(|entity| seen.insert(entity.clone()))
        .map(|entity| SoupRealtimePatch::for_entity(Patch::Updated(entity)))
        .collect())
}
