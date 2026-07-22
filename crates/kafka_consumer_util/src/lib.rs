#![deny(missing_docs)]
//! Environment-aware Kafka consumer transport.
//!
//! This adapter centralizes the repository's plaintext-local versus MSK-IAM
//! transport setup. Application inbound adapters retain responsibility for
//! decoding, retries, poison-message handling, and deciding when to commit.

#[cfg(test)]
mod test;

use std::marker::PhantomData;

use either::Either;
use macro_env::Environment;
use rdkafka::ClientConfig;
use rdkafka::consumer::{CommitMode, Consumer as _, StreamConsumer};
use rdkafka::error::{KafkaError, KafkaResult};
use rdkafka::message::BorrowedMessage;

use macro_event_broker::kafka::msk_iam::{MskIamClientContext, configure_sasl_iam};
use uuid::Uuid;

/// Failure to construct an environment-specific Kafka consumer.
#[derive(Debug, thiserror::Error)]
pub enum KafkaConsumerError {
    /// Failed to create the unauthenticated local consumer.
    #[error("failed to create plaintext Kafka consumer")]
    Plaintext(#[source] KafkaError),
    /// Failed to create the TLS and MSK-IAM authenticated consumer.
    #[error("failed to create MSK IAM Kafka consumer")]
    MskIam(#[source] KafkaError),
}

/// Underlying Kafka consumer transport selected from the runtime environment.
struct ConsumerTransport(Either<StreamConsumer, StreamConsumer<MskIamClientContext>>);

/// Shared Kafka consumer with manual commits and environment-aware transport.
///
/// The consumer uses plaintext when `ENVIRONMENT=local` and MSK IAM otherwise.
/// Automatic commits are disabled and new groups begin at the earliest
/// available offset. Callers choose which records are safe to commit.
pub struct KafkaEventConsumer<T> {
    consumer: ConsumerTransport,
    marker: PhantomData<T>,
}

pub trait GroupName {
    const GROUP_NAME: &'static str;
}

struct MacroKafkaConfig<T> {
    inner: ClientConfig,
    marker: PhantomData<T>,
}

impl<T: GroupName> MacroKafkaConfig<T> {
    pub fn new_grouped(brokers: &str) -> Self {
        let group_id = T::GROUP_NAME;

        let mut config = ClientConfig::new();
        config
            .set("bootstrap.servers", brokers)
            .set("group.id", group_id)
            .set("enable.auto.commit", "false")
            .set("auto.offset.reset", "earliest");
        Self {
            inner: config,
            marker: PhantomData,
        }
    }
}

/// Marker struct which marks the consumer as ungrouped
pub struct Ungrouped;

impl MacroKafkaConfig<Ungrouped> {
    pub fn new_ungrouped(brokers: &str) -> Self {
        /// SAFETY: librdkafka crate requires a group.id to exist to use the safe api
        /// We use a uuid to mimic true ungrouped consumer behaviour which is not properly exposed by this crate.
        /// The only reason this is safe to do is because the typestate pattern prevents callers from calling methods
        /// Which cause kafka to record the 'anonymous' groups.
        /// In other words, we are using typestate to prevent callers from calling commit_message or subscribe on anonymous consumer groups
        let group_id = Uuid::new_v4();

        let mut config = ClientConfig::new();
        config
            .set("bootstrap.servers", brokers)
            .set("group.id", group_id)
            .set("enable.auto.commit", "false")
            .set("auto.offset.reset", "earliest");
        Self {
            inner: config,
            marker: PhantomData,
        }
    }
}

impl<T> KafkaEventConsumer<T> {
    /// Uses the input config selecting plaintext or
    /// MSK IAM transport from the runtime environment.
    pub fn new_from_env(config: MacroKafkaConfig<T>) -> Result<Self, KafkaConsumerError> {
        let MacroKafkaConfig { inner, marker } = config;

        let consumer = match Environment::new_or_prod() {
            Environment::Local => {
                Either::Left(config.create().map_err(KafkaConsumerError::Plaintext)?)
            }
            Environment::Develop | Environment::Production => {
                configure_sasl_iam(&mut config);
                Either::Right(
                    config
                        .create_with_context(MskIamClientContext::from_env())
                        .map_err(KafkaConsumerError::MskIam)?,
                )
            }
        };

        Ok(Self {
            consumer: ConsumerTransport(consumer),
            marker: PhantomData,
        })
    }
}

/// impl block for either named or anonymous consumer groups
impl<T> KafkaConsumerError<T> {
    /// Receives the next Kafka message.
    ///
    /// `StreamConsumer::recv` is cancel-safe and may be used in `tokio::select!`.
    pub async fn recv(&self) -> KafkaResult<BorrowedMessage<'_>> {
        either::for_both!(&self.consumer.0, c => c.recv().await)
    }
}

/// impl block for groups which must be named
impl<T: GroupName> KafkaEventConsumer<T> {
    /// Subscribes the consumer to exactly the provided topics.
    pub fn subscribe(&self, topics: &[&str]) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, c => c.subscribe(topics))
    }

    /// Pauses the partition containing `message`.
    ///
    /// This allows an application to continue consuming other partitions
    /// without later commits advancing past a failed record.
    pub fn pause_message_partition(&self, message: &BorrowedMessage<'_>) -> KafkaResult<()> {
        let mut partitions = TopicPartitionList::new();
        partitions.add_partition(message.topic(), message.partition());
        either::for_both!(&self.consumer.0, c => c.pause(&partitions))
    }

    /// Commits a message using the caller-selected commit mode.
    pub fn commit_message(
        &self,
        message: &BorrowedMessage<'_>,
        mode: CommitMode,
    ) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, c => c.commit_message(message, mode))
    }
}
