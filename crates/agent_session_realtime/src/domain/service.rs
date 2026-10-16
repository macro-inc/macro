//! Fan-out of received runs to per-session subscribers.

#[cfg(test)]
mod test;

use std::{
    num::NonZeroUsize,
    time::{Duration, Instant},
};

use agent_session::domain::model::{AgentSessionId, StoredAgentSessionLog};
use broadcast::{BroadcastManager, GlobalSpawner};
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use super::ports::{AgentSessionLogConsumer, AgentSessionLogSubscriptionService, ReceivedRun};

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

    /// The consumer feeding the fan-out, for its own lifecycle - closing it
    /// on shutdown, say.
    #[must_use]
    pub fn consumer(&self) -> &C {
        &self.consumer
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
    /// Run this in a supervised task. Each run is acknowledged once it was
    /// handed to the session's subscribers, and a run for a session nobody
    /// here subscribed to is acknowledged straight away: the durable log
    /// already has it. A failed acknowledgement is logged, not fatal; the run
    /// is delivered again, and subscribers fold by row id.
    #[tracing::instrument(skip(self), err)]
    pub async fn run(&self) -> Result<(), Report> {
        loop {
            let received = Retry::start(receive_retry_strategy(), || self.consumer.recv())
                .await
                .context(format!(
                    "failed to receive appended agent session log frames after {MAX_RECEIVE_ATTEMPTS} attempts"
                ))?;
            self.distribute(received).await;
        }
    }

    /// Hand one run to its session's subscribers, then acknowledge it.
    #[tracing::instrument(
        name = "agent.session.log.fan_out",
        skip_all,
        fields(
            agent.session.id = %received.run.agent_session_id,
            agent.log.frame_count = received.run.entries.len(),
            agent.log.delivery_id = %received.delivery,
            agent.log.redelivered = received.redelivered,
            agent.log.subscriber_count = tracing::field::Empty,
            agent.log.acked = tracing::field::Empty,
            agent.log.fan_out_us = tracing::field::Empty,
            agent.log.ack_us = tracing::field::Empty,
        )
    )]
    async fn distribute(&self, received: ReceivedRun) {
        let span = tracing::Span::current();
        let ReceivedRun {
            run,
            delivery,
            redelivered,
        } = received;
        let session_id = run.agent_session_id;
        let frame_count = run.entries.len();

        let started = Instant::now();
        let subscriber_count = self
            .broadcasts
            .publish(&session_id, run.into_stored())
            .unwrap_or(0);
        span.record("agent.log.fan_out_us", elapsed_us(started));
        span.record("agent.log.subscriber_count", subscriber_count);
        if subscriber_count == 0 {
            tracing::trace!(
                %session_id,
                frame_count,
                "no subscribers for appended agent session log frames; acknowledging"
            );
        } else {
            tracing::debug!(
                %session_id,
                frame_count,
                subscriber_count,
                redelivered,
                "distributed appended agent session log frames"
            );
        }

        let started = Instant::now();
        let acked = self.consumer.ack(&delivery).await.inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                %session_id,
                delivery = %delivery,
                "failed to acknowledge an agent session log run; it will be delivered again"
            );
        });
        span.record("agent.log.ack_us", elapsed_us(started));
        span.record("agent.log.acked", acked.is_ok());
    }
}

/// Microseconds since `started`, saturating.
fn elapsed_us(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX)
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
