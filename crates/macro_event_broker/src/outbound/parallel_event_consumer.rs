//! Typed bounded-parallel Kafka event consumption.
//!
//! This adapter decodes a declared [`MacroEventCollection`], invokes a typed
//! [`Handler`], and applies a [`DeliveryPolicy`] before reporting a record as
//! commit-safe to `kafka_util`'s message-agnostic coordinator. Attempt timeouts
//! begin only after the coordinator starts the record in a processing slot;
//! backoff and time spent waiting for a slot are outside those timeouts.
//!
//! # Example
//!
//! ```no_run
//! use std::convert::Infallible;
//! use std::time::Duration;
//!
//! use kafka_util::GroupName;
//! use kafka_util::parallel::ParallelConsumerConfig;
//! use macro_event_broker::{
//!     EventBrokerError, Handler, MacroEventCollection, MessageParts, UniformBoundedRetry,
//!     run_parallel_event_consumer,
//! };
//!
//! struct ConsumerGroup;
//!
//! impl GroupName for ConsumerGroup {
//!     const GROUP_NAME: &'static str = "example-parallel-consumer";
//! }
//!
//! struct Events;
//!
//! impl MacroEventCollection for Events {
//!     fn decode<T: MessageParts>(_message: &T) -> Result<Self, EventBrokerError> {
//!         Ok(Self)
//!     }
//!
//!     fn topics() -> &'static [&'static str] {
//!         &["example.events"]
//!     }
//! }
//!
//! struct EventHandler;
//!
//! impl Handler<Events> for EventHandler {
//!     type Error = Infallible;
//!
//!     async fn handle(&self, _event: Events) -> Result<(), Self::Error> {
//!         Ok(())
//!     }
//! }
//!
//! # async fn run() -> Result<(), Box<dyn std::error::Error>> {
//! let parallel = ParallelConsumerConfig::new(16, 64)?;
//! run_parallel_event_consumer::<ConsumerGroup, Events, _, _>(
//!     "localhost:9092",
//!     Duration::from_secs(300),
//!     parallel,
//!     EventHandler,
//!     UniformBoundedRetry::default(),
//! )
//! .await?;
//! # Ok(())
//! # }
//! ```

#[cfg(test)]
mod test;

use std::fmt::Debug;
use std::sync::Arc;
use std::time::Duration;

use kafka_util::parallel::{ParallelConsumerConfig, ParallelConsumerError, run_parallel_consumer};
use kafka_util::{GroupName, KafkaConsumerError, KafkaEventConsumer};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{Message as _, OwnedMessage};

use super::kafka_event_consumer::KafkaConsumerAdapter;
use crate::{EventBrokerError, MacroEventCollection, MessageParts};

const DEFAULT_MAX_ATTEMPTS: usize = 5;
const DEFAULT_BASE_BACKOFF: Duration = Duration::from_secs(1);
const DEFAULT_PER_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(300);
const UNKNOWN_MESSAGE_FIELD: &str = "unknown";
const MAX_BACKOFF_DOUBLINGS: usize = 128;

/// Stable log message emitted when a delivery policy drops an event.
///
/// Consumer runbooks and log queries match this exact text. Changing it is a
/// breaking operational change, even when the Rust API remains compatible.
pub const DROP_LOG_MESSAGE: &str = "dropping event after exhausting delivery attempts";

/// Handles one decoded event from a declared [`MacroEventCollection`].
///
/// Returning `Ok(())` marks the attempt successful and commit-safe. This
/// includes both processed events and events the application intentionally
/// ignores. Returning an error delegates the delivery decision to the
/// configured [`DeliveryPolicy`].
///
/// On partition revocation, in-flight handler futures are aborted and may be
/// dropped at any await point. Handlers must therefore be idempotent for
/// at-least-once redelivery and cancellation-safe partway through side effects;
/// for example, avoid dangling manual two-phase state outside a transaction.
pub trait Handler<M: MacroEventCollection>: Send + Sync + 'static {
    /// Error returned when an event attempt fails.
    type Error: Debug + Send + Sync + 'static;

    /// Processes one decoded event.
    fn handle(&self, event: M) -> impl Future<Output = Result<(), Self::Error>> + Send;
}

/// Failure produced by one event delivery attempt.
#[derive(Debug, thiserror::Error)]
pub enum DeliveryError<E: Debug> {
    /// The broker payload could not be decoded as the declared event collection.
    #[error("failed to decode the declared event: {0}")]
    Decode(#[source] EventBrokerError),
    /// The application handler returned an error.
    #[error("event handler failed: {0:?}")]
    Handler(E),
    /// The attempt exceeded its policy-provided timeout.
    #[error("event delivery attempt timed out after {timeout:?}")]
    Timeout {
        /// Timeout applied to this attempt.
        timeout: Duration,
    },
}

/// Decision made by a [`DeliveryPolicy`] after an attempt fails.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeliveryDecision {
    /// Retry after the supplied delay.
    Retry(Duration),
    /// Drop the record and allow its offset to commit.
    Drop,
    /// Terminate the consumer without committing the failed record.
    Fatal,
}

/// Selects timeout, retry, drop, and fatal behavior for failed attempts.
///
/// `attempt` passed to [`Self::decide`] is one-based: the initial attempt is
/// `1`, the first retry is `2`, and so on. Decode, handler, and timeout errors
/// all pass through this same policy boundary.
pub trait DeliveryPolicy<E: Debug>: Send + Sync + 'static {
    /// Returns the timeout applied independently to every attempt.
    fn per_attempt_timeout(&self) -> Duration;

    /// Decides what to do after the numbered attempt returned `error`.
    fn decide(&self, attempt: usize, error: &DeliveryError<E>) -> DeliveryDecision;
}

/// Uniform bounded retry with exponential backoff and commit-safe exhaustion.
///
/// Decode failures are dropped after the initial attempt because retrying the
/// same payload cannot succeed. For handler and timeout failures, the default
/// performs five total attempts, waits 1, 2, 4, then 8 seconds between them,
/// gives every attempt a fresh 300-second timeout, and drops the event after
/// the fifth failure. There is no deadline over the full lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UniformBoundedRetry {
    /// Maximum total attempts, including the initial attempt.
    ///
    /// A value of zero still permits the unavoidable initial attempt and drops
    /// its failure immediately.
    pub max_attempts: usize,
    /// Delay before the first retry. Each later retry doubles this delay.
    pub base_backoff: Duration,
    /// Timeout applied freshly when each individual attempt begins.
    pub per_attempt_timeout: Duration,
}

impl UniformBoundedRetry {
    fn retry_delay(self, attempt: usize) -> Duration {
        if self.base_backoff.is_zero() {
            return Duration::ZERO;
        }

        let doublings = attempt.saturating_sub(1).min(MAX_BACKOFF_DOUBLINGS);
        let mut delay = self.base_backoff;
        for _ in 0..doublings {
            delay = delay.saturating_mul(2);
        }
        delay
    }
}

impl Default for UniformBoundedRetry {
    fn default() -> Self {
        Self {
            max_attempts: DEFAULT_MAX_ATTEMPTS,
            base_backoff: DEFAULT_BASE_BACKOFF,
            per_attempt_timeout: DEFAULT_PER_ATTEMPT_TIMEOUT,
        }
    }
}

impl<E: Debug> DeliveryPolicy<E> for UniformBoundedRetry {
    fn per_attempt_timeout(&self) -> Duration {
        self.per_attempt_timeout
    }

    fn decide(&self, attempt: usize, error: &DeliveryError<E>) -> DeliveryDecision {
        if matches!(error, DeliveryError::Decode(_)) || attempt >= self.max_attempts.max(1) {
            DeliveryDecision::Drop
        } else {
            DeliveryDecision::Retry(self.retry_delay(attempt))
        }
    }
}

/// Failure while constructing, subscribing, or running a typed parallel consumer.
#[derive(Debug, thiserror::Error)]
pub enum ParallelEventConsumerError<E: Debug> {
    /// The environment-aware cooperative Kafka consumer could not be created.
    #[error("failed to create the parallel Kafka event consumer")]
    ConsumerCreation(#[source] KafkaConsumerError),
    /// Kafka rejected the declared event-topic subscription.
    #[error("failed to subscribe the parallel Kafka event consumer: {0:?}")]
    Subscription(rootcause::Report),
    /// The message-agnostic coordinator terminated fatally.
    #[error("parallel Kafka event consumption terminated")]
    Consumption(#[source] ParallelConsumerError<DeliveryError<E>>),
}

/// Creates and runs a typed bounded-parallel Kafka consumer.
///
/// This is the composition entry point intended for a service's `main`: it
/// creates the cooperative max-poll consumer, subscribes through
/// [`KafkaConsumerAdapter`] to exactly `M::topics()`, and runs the bounded
/// coordinator. Successful handling and policy drops are commit-safe. A
/// [`DeliveryDecision::Fatal`] stops the coordinator without committing the
/// failed record. Offset commits are submitted asynchronously.
///
/// A retrying record occupies one processing-concurrency slot for its entire
/// attempt and backoff lifecycle. For a bounded policy, its worst-case slot
/// occupancy is the per-attempt timeout multiplied by the number of attempts,
/// plus total backoff. Prolonged records can fill all processing slots and then
/// `max_outstanding`, so size parallel capacity and delivery policy together.
///
/// `max_poll_interval` configures librdkafka's group-liveness limit; it is not
/// an event processing deadline. The coordinator continues polling while
/// records are queued, handled, or waiting in retry backoff.
pub async fn run_parallel_event_consumer<G, M, H, P>(
    brokers: &str,
    max_poll_interval: Duration,
    parallel_config: ParallelConsumerConfig,
    handler: H,
    policy: P,
) -> Result<(), ParallelEventConsumerError<H::Error>>
where
    G: GroupName,
    M: MacroEventCollection + Send + 'static,
    H: Handler<M>,
    P: DeliveryPolicy<H::Error>,
{
    let consumer =
        KafkaEventConsumer::<G>::from_env_with_max_poll_interval(brokers, max_poll_interval)
            .map_err(ParallelEventConsumerError::ConsumerCreation)?;
    let consumer = KafkaConsumerAdapter::<G, ()>::new(consumer)
        .subscribe::<M>()
        .map_err(ParallelEventConsumerError::Subscription)?
        .into_inner();

    let handler = Arc::new(handler);
    let policy = Arc::new(policy);
    run_parallel_consumer(
        consumer,
        parallel_config,
        CommitMode::Async,
        move |message| {
            process_message::<M, H, P>(message, Arc::clone(&handler), Arc::clone(&policy))
        },
    )
    .await
    .map_err(ParallelEventConsumerError::Consumption)
}

async fn process_message<M, H, P>(
    message: OwnedMessage,
    handler: Arc<H>,
    policy: Arc<P>,
) -> Result<(), DeliveryError<H::Error>>
where
    M: MacroEventCollection + Send + 'static,
    H: Handler<M>,
    P: DeliveryPolicy<H::Error>,
{
    let metadata = DeliveryMetadata::from_message(&message);
    let mut attempt = 1usize;

    loop {
        let timeout = policy.per_attempt_timeout();
        let result = tokio::time::timeout(timeout, deliver_once::<M, H>(&message, &handler)).await;
        let error = match result {
            Ok(Ok(())) => return Ok(()),
            Ok(Err(error)) => error,
            Err(_) => DeliveryError::Timeout { timeout },
        };

        match policy.decide(attempt, &error) {
            DeliveryDecision::Retry(delay) => {
                let Some(next_attempt) = attempt.checked_add(1) else {
                    return Err(error);
                };
                tokio::time::sleep(delay).await;
                attempt = next_attempt;
            }
            DeliveryDecision::Drop => {
                log_dropped_event(&metadata, attempt, &error);
                return Ok(());
            }
            DeliveryDecision::Fatal => return Err(error),
        }
    }
}

async fn deliver_once<M, H>(
    message: &OwnedMessage,
    handler: &H,
) -> Result<(), DeliveryError<H::Error>>
where
    M: MacroEventCollection + Send + 'static,
    H: Handler<M>,
{
    let event = M::decode(message).map_err(DeliveryError::Decode)?;
    handler.handle(event).await.map_err(DeliveryError::Handler)
}

fn log_dropped_event<E: Debug>(
    metadata: &DeliveryMetadata,
    attempts: usize,
    error: &DeliveryError<E>,
) {
    tracing::error!(
        attempts,
        event_type = %metadata.event_type,
        key = %metadata.key,
        topic = %metadata.topic,
        partition = metadata.partition,
        offset = metadata.offset,
        error = ?error,
        "{}",
        DROP_LOG_MESSAGE,
    );
}

struct DeliveryMetadata {
    event_type: String,
    key: String,
    topic: String,
    partition: i32,
    offset: i64,
}

impl DeliveryMetadata {
    fn from_message(message: &OwnedMessage) -> Self {
        Self {
            event_type: extract_event_type(MessageParts::payload(message)),
            key: MessageParts::key(message)
                .unwrap_or(UNKNOWN_MESSAGE_FIELD)
                .to_owned(),
            topic: MessageParts::topic(message).to_owned(),
            partition: message.partition(),
            offset: message.offset(),
        }
    }
}

fn extract_event_type(payload: Option<&[u8]>) -> String {
    payload
        .and_then(|payload| serde_json::from_slice::<serde_json::Value>(payload).ok())
        .and_then(|json| {
            json.get("event_type")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| UNKNOWN_MESSAGE_FIELD.to_owned())
}
