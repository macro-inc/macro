//! Fan-out of received runs to per-session subscribers.

#[cfg(test)]
mod test;

use std::{num::NonZeroUsize, time::Duration};

use agent_session::domain::model::{AgentSessionId, StoredAgentSessionLog};
use broadcast::{BroadcastManager, GlobalSpawner};
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use super::ports::{AgentSessionLogConsumer, AgentSessionLogSubscriptionService};

/// Runs retained by each session-keyed broadcast channel.
const BROADCAST_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(64).unwrap();
/// Runs buffered for each individual subscriber.
const SUBSCRIBER_BUFFER_CAPACITY: NonZeroUsize = NonZeroUsize::new(16).unwrap();
/// Total receive attempts before the consumer returns for supervision.
const MAX_RECEIVE_ATTEMPTS: usize = 5;

/// Retries after one, two, four, and eight seconds.
fn receive_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take(MAX_RECEIVE_ATTEMPTS - 1)
}

/// Receives runs from `consumer` and hands each to the session's subscribers.
pub struct AgentSessionLogConsumerService<C>
where
    C: AgentSessionLogConsumer,
{
    consumer: C,
    broadcasts: BroadcastManager<GlobalSpawner, AgentSessionId, Vec<StoredAgentSessionLog>>,
}

impl<C> AgentSessionLogConsumerService<C>
where
    C: AgentSessionLogConsumer,
{
    /// Fan out what `consumer` receives.
    pub fn new(consumer: C) -> Self {
        Self {
            consumer,
            broadcasts: BroadcastManager::new(GlobalSpawner, BROADCAST_BUFFER_CAPACITY),
        }
    }

    /// Subscribes to runs appended to `session_id`.
    ///
    /// The receiver is closed if its buffer fills, so a slow subscriber
    /// cannot delay the shared consumer or other subscribers.
    #[must_use]
    pub fn subscribe(
        &self,
        session_id: AgentSessionId,
    ) -> tokio::sync::mpsc::Receiver<Vec<StoredAgentSessionLog>> {
        self.broadcasts
            .subscribe(session_id, SUBSCRIBER_BUFFER_CAPACITY)
            .into_receiver()
    }

    /// Receives runs and distributes them until reception fails for good.
    ///
    /// Run this in a supervised task. A run for a session nobody subscribed
    /// to is dropped: the durable log already has it.
    #[tracing::instrument(skip(self), err)]
    pub async fn run(&self) -> Result<(), Report> {
        loop {
            let appended = Retry::start(receive_retry_strategy(), || self.consumer.recv())
                .await
                .context(format!(
                    "failed to receive appended agent session log frames after {MAX_RECEIVE_ATTEMPTS} attempts"
                ))?;
            let session_id = appended.agent_session_id;
            match self.broadcasts.publish(&session_id, appended.into_stored()) {
                Ok(subscriber_count) => tracing::trace!(
                    %session_id,
                    subscriber_count,
                    "distributed appended agent session log frames"
                ),
                Err(_) => tracing::trace!(
                    %session_id,
                    "dropping appended agent session log frames without subscribers"
                ),
            }
        }
    }
}

impl<C> AgentSessionLogSubscriptionService for AgentSessionLogConsumerService<C>
where
    C: AgentSessionLogConsumer,
{
    fn subscribe(
        &self,
        session_id: AgentSessionId,
    ) -> tokio::sync::mpsc::Receiver<Vec<StoredAgentSessionLog>> {
        AgentSessionLogConsumerService::subscribe(self, session_id)
    }
}
