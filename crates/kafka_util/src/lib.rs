#![deny(missing_docs)]
//! Environment-aware Kafka producer and consumer transports.
//!
//! These adapters centralize the repository's plaintext-local versus MSK-IAM
//! transport setup. Application inbound adapters retain responsibility for
//! decoding, retries, poison-message handling, and deciding when to commit.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::marker::PhantomData;
use std::time::Duration;

use either::Either;
use macro_env::Environment;
use opentelemetry::propagation::{Extractor, Injector};
use rdkafka::consumer::{CommitMode, Consumer, ConsumerContext, StreamConsumer};
use rdkafka::error::{KafkaError, KafkaResult};
use rdkafka::message::{BorrowedMessage, Header, Headers, Message, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::{ClientConfig, Offset, TopicPartitionList};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use uuid::Uuid;

pub use msk_iam::{MskIamClientContext, configure_sasl_iam};

mod msk_iam;

const UNGROUPED_GROUP_PREFIX: &str = "macro-event-broker-independent";
const MESSAGE_TIMEOUT_MS: &str = "5000";
const SEND_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct TraceHeaderInjector(HashMap<String, String>);

impl Injector for TraceHeaderInjector {
    fn set(&mut self, key: &str, value: String) {
        self.0.insert(key.to_owned(), value);
    }
}

struct TraceHeaderExtractor<'a, H: Headers>(&'a H);

impl<H: Headers> Extractor for TraceHeaderExtractor<'_, H> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.iter().find_map(|header| {
            (header.key == key)
                .then(|| {
                    header
                        .value
                        .and_then(|value| std::str::from_utf8(value).ok())
                })
                .flatten()
        })
    }

    fn keys(&self) -> Vec<&str> {
        self.0.iter().map(|header| header.key).collect()
    }
}

fn current_trace_headers() -> OwnedHeaders {
    let context = tracing::Span::current().context();
    let mut injector = TraceHeaderInjector::default();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut injector);
    });

    injector
        .0
        .into_iter()
        .fold(OwnedHeaders::new(), |headers, (key, value)| {
            headers.insert(Header {
                key: &key,
                value: Some(&value),
            })
        })
}

fn remote_trace_context<M: Message>(message: &M) -> opentelemetry::Context {
    opentelemetry::global::get_text_map_propagator(|propagator| {
        message
            .headers()
            .map_or_else(opentelemetry::Context::new, |headers| {
                propagator.extract(&TraceHeaderExtractor(headers))
            })
    })
}

/// Creates a Kafka processing span parented to the message's propagated W3C context.
///
/// The caller should instrument the complete decode, handling, and commit future
/// with this span so the consumer operation represents all record processing.
pub fn consumer_span<M: Message>(message: &M, consumer_group: &'static str) -> tracing::Span {
    let span = tracing::info_span!(
        "kafka.process",
        otel.kind = "consumer",
        messaging.system = "kafka",
        messaging.operation.name = "process",
        messaging.operation.type = "process",
        messaging.consumer.group.name = consumer_group,
        messaging.destination.name = message.topic(),
        messaging.destination.partition.id = %message.partition(),
        messaging.kafka.offset = message.offset(),
        macro.event.id = tracing::field::Empty,
        macro.event.type = tracing::field::Empty,
        agent.session.id = tracing::field::Empty,
        otel.status_code = tracing::field::Empty,
        otel.status_description = tracing::field::Empty,
    );
    let parent = remote_trace_context(message);
    // Setting an empty context is intentional: headerless records must not
    // inherit an unrelated process- or task-lifetime ambient span.
    let _ = span.set_parent(parent);
    span
}

/// Marks a manually-created messaging span as failed.
pub fn record_span_error(span: &tracing::Span, error: &(impl std::fmt::Display + ?Sized)) {
    span.record("otel.status_code", "ERROR");
    span.record("otel.status_description", tracing::field::display(error));
}

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

/// Failure to construct an environment-specific Kafka producer.
#[derive(Debug, thiserror::Error)]
pub enum KafkaProducerError {
    /// Failed to create the unauthenticated local producer.
    #[error("failed to create plaintext Kafka producer")]
    Plaintext(#[source] KafkaError),
    /// Failed to create the TLS and MSK-IAM authenticated producer.
    #[error("failed to create MSK IAM Kafka producer")]
    MskIam(#[source] KafkaError),
}

/// Underlying Kafka consumer transport selected from the runtime environment.
struct ConsumerTransport(Either<StreamConsumer, StreamConsumer<MskIamClientContext>>);

/// Underlying Kafka producer transport selected from the runtime environment.
#[derive(Clone)]
struct ProducerTransport(Either<FutureProducer, FutureProducer<MskIamClientContext>>);

/// Type-level name for a durable Kafka consumer group.
///
/// Defining group names on marker types keeps group identities centralized and
/// prevents consumers from passing arbitrary string group IDs at construction.
pub trait GroupName {
    /// Stable Kafka consumer group ID used for partition balancing and offsets.
    const GROUP_NAME: &'static str;
}

/// Marker type for a consumer that does not subscribe or persist offsets.
///
/// librdkafka requires a configured `group.id` for its safe manual-assignment
/// API, so this mode uses a generated internal ID. It never exposes subscription
/// or commit operations and therefore does not create durable group state.
pub struct Ungrouped;

/// Starting position for manually assigned ungrouped topic partitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InitialOffset {
    /// Consume all currently retained records before continuing with new ones.
    Earliest,
    /// Consume only records published after the partition assignment begins.
    Latest,
}

/// Shared Kafka consumer with environment-aware transport and type-safe group behavior.
///
/// Consumers parameterized by a [`GroupName`] may subscribe and commit offsets.
/// [`Ungrouped`] consumers instead manually assign every partition of their
/// requested topics and cannot subscribe or commit.
pub struct KafkaEventConsumer<T> {
    consumer: ConsumerTransport,
    marker: PhantomData<T>,
}

/// Shared Kafka producer with environment-aware transport.
#[derive(Clone)]
pub struct KafkaEventProducer {
    producer: ProducerTransport,
}

fn base_config(brokers: &str) -> ClientConfig {
    let mut config = ClientConfig::new();
    config.set("bootstrap.servers", brokers);
    config
}

fn consumer_config(brokers: &str) -> ClientConfig {
    let mut config = base_config(brokers);
    config.set("enable.auto.commit", "false");
    config
}

fn producer_config(brokers: &str) -> ClientConfig {
    let mut config = base_config(brokers);
    config.set("message.timeout.ms", MESSAGE_TIMEOUT_MS);
    config
}

fn grouped_config<T: GroupName>(brokers: &str) -> ClientConfig {
    let mut config = consumer_config(brokers);
    config
        .set("group.id", T::GROUP_NAME)
        .set("auto.offset.reset", "earliest");
    config
}

fn ungrouped_config(brokers: &str) -> ClientConfig {
    let mut config = consumer_config(brokers);
    let group_id = format!("{UNGROUPED_GROUP_PREFIX}-{}", Uuid::new_v4());
    config
        .set("group.id", group_id)
        .set("enable.auto.offset.store", "false");
    config
}

fn create_consumer_from_env<T>(
    config: ClientConfig,
) -> Result<KafkaEventConsumer<T>, KafkaConsumerError> {
    let consumer = match Environment::new_or_prod() {
        Environment::Local => Either::Left(config.create().map_err(KafkaConsumerError::Plaintext)?),
        Environment::Develop | Environment::Production => {
            let config = configure_sasl_iam(config);
            Either::Right(
                config
                    .create_with_context(MskIamClientContext::from_env())
                    .map_err(KafkaConsumerError::MskIam)?,
            )
        }
    };

    Ok(KafkaEventConsumer {
        consumer: ConsumerTransport(consumer),
        marker: PhantomData,
    })
}

fn create_producer_from_env(
    config: ClientConfig,
) -> Result<KafkaEventProducer, KafkaProducerError> {
    let producer = match Environment::new_or_prod() {
        Environment::Local => Either::Left(config.create().map_err(KafkaProducerError::Plaintext)?),
        Environment::Develop | Environment::Production => {
            let config = configure_sasl_iam(config);
            Either::Right(
                config
                    .create_with_context(MskIamClientContext::from_env())
                    .map_err(KafkaProducerError::MskIam)?,
            )
        }
    };

    Ok(KafkaEventProducer {
        producer: ProducerTransport(producer),
    })
}

/// Polls the consumer once with a no-op waker so OAUTHBEARER installs its
/// initial token before a synchronous broker request (metadata, list offsets)
/// needs a connection.
fn prime_oauth_token<C: ConsumerContext + 'static>(consumer: &StreamConsumer<C>) {
    let mut recv = std::pin::pin!(consumer.recv());
    let waker = std::task::Waker::noop();
    let mut context = std::task::Context::from_waker(waker);
    let _ = std::future::Future::poll(recv.as_mut(), &mut context);
}

fn build_assignment<C, T>(
    consumer: &T,
    topics: &[&str],
    offset: Offset,
    metadata_timeout: Duration,
) -> KafkaResult<TopicPartitionList>
where
    C: ConsumerContext,
    T: Consumer<C>,
{
    if topics.is_empty() {
        return Err(KafkaError::Subscription(
            "at least one topic is required for assignment".to_string(),
        ));
    }

    let mut assignment = TopicPartitionList::new();
    for topic in topics {
        let metadata = consumer.fetch_metadata(Some(topic), metadata_timeout)?;
        let topic_metadata = metadata
            .topics()
            .iter()
            .find(|metadata| metadata.name() == *topic)
            .ok_or_else(|| {
                KafkaError::Subscription(format!(
                    "metadata response did not include requested topic {topic}"
                ))
            })?;

        if let Some(error) = topic_metadata.error() {
            return Err(KafkaError::MetadataFetch(error.into()));
        }
        if topic_metadata.partitions().is_empty() {
            return Err(KafkaError::Subscription(format!(
                "requested topic {topic} has no partitions"
            )));
        }

        for partition in topic_metadata.partitions() {
            if let Some(error) = partition.error() {
                return Err(KafkaError::MetadataFetch(error.into()));
            }
            assignment.add_partition_offset(topic, partition.id(), offset)?;
        }
    }

    Ok(assignment)
}

impl KafkaEventProducer {
    /// Creates a producer, selecting plaintext or MSK IAM transport from the runtime environment.
    ///
    /// Producer creation is lazy: no broker connection or IAM token is created
    /// until a message is sent.
    pub fn from_env(brokers: &str) -> Result<Self, KafkaProducerError> {
        create_producer_from_env(producer_config(brokers))
    }

    /// Sends a keyed payload to `topic` and waits for delivery confirmation.
    #[tracing::instrument(
        name = "kafka.publish",
        err,
        skip(self, payload),
        fields(
            otel.kind = "producer",
            messaging.system = "kafka",
            messaging.operation.name = "publish",
            messaging.operation.type = "send",
            messaging.destination.name = topic,
        )
    )]
    pub async fn send(&self, topic: &str, key: &str, payload: &[u8]) -> KafkaResult<()> {
        let record = FutureRecord::to(topic)
            .key(key)
            .payload(payload)
            .headers(current_trace_headers());
        either::for_both!(&self.producer.0, producer => producer.send(record, SEND_TIMEOUT).await)
            .map(|_| ())
            .map_err(|(error, _)| error)
    }
}

impl<T> KafkaEventConsumer<T> {
    /// Receives the next Kafka message.
    ///
    /// `StreamConsumer::recv` is cancel-safe and may be used in `tokio::select!`.
    pub async fn recv(&self) -> KafkaResult<BorrowedMessage<'_>> {
        either::for_both!(&self.consumer.0, consumer => consumer.recv().await)
    }

    /// Pauses the partition containing `message`.
    ///
    /// Grouped consumers can use this to prevent a later cumulative commit
    /// from advancing past a failed record. Ungrouped consumers can use it to
    /// stop additional delivery from a failed partition.
    pub fn pause_message_partition(&self, message: &BorrowedMessage<'_>) -> KafkaResult<()> {
        let mut partitions = TopicPartitionList::new();
        partitions.add_partition(message.topic(), message.partition());
        either::for_both!(&self.consumer.0, consumer => consumer.pause(&partitions))
    }
}

impl<T: GroupName> KafkaEventConsumer<T> {
    /// Creates a named-group consumer, selecting plaintext or MSK IAM transport
    /// from the runtime environment.
    pub fn from_env(brokers: &str) -> Result<Self, KafkaConsumerError> {
        create_consumer_from_env(grouped_config::<T>(brokers))
    }

    /// Subscribes the consumer to exactly the provided topics.
    pub fn subscribe(&self, topics: &[&str]) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => consumer.subscribe(topics))
    }

    /// Commits a message using the caller-selected commit mode.
    pub fn commit_message(
        &self,
        message: &BorrowedMessage<'_>,
        mode: CommitMode,
    ) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => consumer.commit_message(message, mode))
    }
}

impl KafkaEventConsumer<Ungrouped> {
    /// Creates an ungrouped consumer, selecting plaintext or MSK IAM transport
    /// from the runtime environment.
    ///
    /// Call [`Self::assign_topics`] before receiving messages.
    pub fn from_env(brokers: &str) -> Result<Self, KafkaConsumerError> {
        create_consumer_from_env(ungrouped_config(brokers))
    }

    /// Manually assigns every current partition of `topics` at `initial_offset`.
    ///
    /// Manual assignment does not join a consumer group, persist offsets, or
    /// automatically discover partitions added after this call. Reconnect to
    /// discover partition-count changes.
    pub fn assign_topics(
        &self,
        topics: &[&str],
        initial_offset: InitialOffset,
        metadata_timeout: Duration,
    ) -> KafkaResult<()> {
        either::for_both!(&self.consumer.0, consumer => {
            prime_oauth_token(consumer);
            let offset = match initial_offset {
                InitialOffset::Earliest => Offset::Beginning,
                InitialOffset::Latest => Offset::End,
            };
            let assignment = build_assignment(consumer, topics, offset, metadata_timeout)?;
            consumer.assign(&assignment)
        })
    }
}
