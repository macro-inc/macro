#![deny(missing_docs)]
//! Environment-aware Kafka consumer transport.
//!
//! This adapter centralizes the repository's plaintext-local versus MSK-IAM
//! transport setup. Application inbound adapters retain responsibility for
//! decoding, retries, poison-message handling, and deciding when to commit.

#[cfg(test)]
mod test;

use macro_env::Environment;
use rdkafka::ClientConfig;
use rdkafka::TopicPartitionList;
use rdkafka::consumer::{CommitMode, Consumer as _, StreamConsumer};
use rdkafka::error::{KafkaError, KafkaResult};
use rdkafka::message::{BorrowedMessage, Message as _};

use macro_event_broker::kafka::msk_iam::{MskIamClientContext, configure_sasl_iam};

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
enum ConsumerTransport {
    /// Unauthenticated plaintext connection for the local broker.
    Plaintext(StreamConsumer),
    /// TLS and SASL/OAUTHBEARER connection for deployed MSK clusters.
    MskIam(StreamConsumer<MskIamClientContext>),
}

/// Shared Kafka consumer with manual commits and environment-aware transport.
///
/// The consumer uses plaintext when `ENVIRONMENT=local` and MSK IAM otherwise.
/// Automatic commits are disabled and new groups begin at the earliest
/// available offset. Callers choose which records are safe to commit.
pub struct KafkaEventConsumer {
    consumer: ConsumerTransport,
}

fn base_config(brokers: &str, group_id: &str) -> ClientConfig {
    let mut config = ClientConfig::new();
    config
        .set("bootstrap.servers", brokers)
        .set("group.id", group_id)
        .set("enable.auto.commit", "false")
        .set("auto.offset.reset", "earliest");
    config
}

impl KafkaEventConsumer {
    /// Creates a consumer for `brokers` and `group_id`, selecting plaintext or
    /// MSK IAM transport from the runtime environment.
    pub fn from_env(brokers: &str, group_id: &str) -> Result<Self, KafkaConsumerError> {
        let mut config = base_config(brokers, group_id);
        let consumer = match Environment::new_or_prod() {
            Environment::Local => ConsumerTransport::Plaintext(
                config.create().map_err(KafkaConsumerError::Plaintext)?,
            ),
            Environment::Develop | Environment::Production => {
                configure_sasl_iam(&mut config);
                ConsumerTransport::MskIam(
                    config
                        .create_with_context(MskIamClientContext::from_env())
                        .map_err(KafkaConsumerError::MskIam)?,
                )
            }
        };

        Ok(Self { consumer })
    }

    /// Subscribes the consumer to exactly the provided topics.
    pub fn subscribe(&self, topics: &[&str]) -> KafkaResult<()> {
        match &self.consumer {
            ConsumerTransport::Plaintext(consumer) => consumer.subscribe(topics),
            ConsumerTransport::MskIam(consumer) => consumer.subscribe(topics),
        }
    }

    /// Receives the next Kafka message.
    ///
    /// `StreamConsumer::recv` is cancel-safe and may be used in `tokio::select!`.
    pub async fn recv(&self) -> KafkaResult<BorrowedMessage<'_>> {
        match &self.consumer {
            ConsumerTransport::Plaintext(consumer) => consumer.recv().await,
            ConsumerTransport::MskIam(consumer) => consumer.recv().await,
        }
    }

    /// Pauses the partition containing `message`.
    ///
    /// This allows an application to continue consuming other partitions
    /// without later commits advancing past a failed record.
    pub fn pause_message_partition(&self, message: &BorrowedMessage<'_>) -> KafkaResult<()> {
        let mut partitions = TopicPartitionList::new();
        partitions.add_partition(message.topic(), message.partition());
        match &self.consumer {
            ConsumerTransport::Plaintext(consumer) => consumer.pause(&partitions),
            ConsumerTransport::MskIam(consumer) => consumer.pause(&partitions),
        }
    }

    /// Commits a message using the caller-selected commit mode.
    pub fn commit_message(
        &self,
        message: &BorrowedMessage<'_>,
        mode: CommitMode,
    ) -> KafkaResult<()> {
        match &self.consumer {
            ConsumerTransport::Plaintext(consumer) => consumer.commit_message(message, mode),
            ConsumerTransport::MskIam(consumer) => consumer.commit_message(message, mode),
        }
    }
}
