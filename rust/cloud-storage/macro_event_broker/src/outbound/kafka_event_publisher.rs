//! Kafka adapter for the [`EventPublisher`] port.
//!
//! Wraps an `rdkafka` [`FutureProducer`] to publish events. The broker address
//! is supplied by the caller (typically from environment configuration at the
//! consuming service); the transport is chosen here from the `ENVIRONMENT`
//! variable: `Local` uses a plaintext connection (the docker-compose broker),
//! while `Develop` / `Production` use TLS + SASL/OAUTHBEARER with AWS MSK IAM
//! auth via [`MskIamClientContext`].

use std::time::Duration;

use macro_env::Environment;
use macro_event_topics::Topic;
use rdkafka::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};

use crate::domain::models::EventBrokerError;
use crate::domain::ports::EventPublisher;
use crate::outbound::msk_iam::{MskIamClientContext, configure_sasl_iam};

/// How long a record may sit in the producer queue before delivery is considered failed.
const MESSAGE_TIMEOUT_MS: &str = "5000";

/// How long [`EventPublisher::publish`] waits for delivery confirmation before timing out.
const SEND_TIMEOUT: Duration = Duration::from_secs(5);

/// The underlying producer, split by transport.
#[derive(Clone)]
enum Producer {
    /// Unauthenticated plaintext connection (local docker broker).
    Plaintext(FutureProducer),
    /// TLS + SASL/OAUTHBEARER with AWS MSK IAM auth (deployed clusters).
    MskIam(FutureProducer<MskIamClientContext>),
}

/// Kafka-backed implementation of [`EventPublisher`].
#[derive(Clone)]
pub struct KafkaEventPublisher {
    producer: Producer,
}

fn base_config(brokers: &str) -> ClientConfig {
    let mut config = ClientConfig::new();
    config
        .set("bootstrap.servers", brokers)
        .set("message.timeout.ms", MESSAGE_TIMEOUT_MS);
    config
}

fn create_error(e: impl std::fmt::Display) -> EventBrokerError {
    EventBrokerError::Publish(format!("failed to create producer: {e}"))
}

impl KafkaEventPublisher {
    /// Build a producer connected to the given comma-separated `brokers` list,
    /// choosing the transport from the `ENVIRONMENT` variable (see the module
    /// docs).
    ///
    /// Producer creation is lazy: nothing connects to Kafka (and no IAM token
    /// is signed) until an event is published.
    pub fn new(brokers: &str) -> Result<Self, EventBrokerError> {
        let producer = match Environment::new_or_prod() {
            Environment::Local => {
                Producer::Plaintext(base_config(brokers).create().map_err(create_error)?)
            }
            Environment::Develop | Environment::Production => {
                let mut config = base_config(brokers);
                configure_sasl_iam(&mut config);

                Producer::MskIam(
                    config
                        .create_with_context(MskIamClientContext::from_env())
                        .map_err(create_error)?,
                )
            }
        };

        Ok(Self { producer })
    }
}

impl EventPublisher for KafkaEventPublisher {
    #[tracing::instrument(err, skip(self, payload), fields(topic = %topic.as_str(), key = %key))]
    async fn publish<T: Topic>(
        &self,
        topic: T,
        key: &str,
        payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        let record = FutureRecord::to(topic.as_str()).key(key).payload(payload);

        match &self.producer {
            Producer::Plaintext(producer) => producer.send(record, SEND_TIMEOUT).await,
            Producer::MskIam(producer) => producer.send(record, SEND_TIMEOUT).await,
        }
        .map_err(|(e, _)| EventBrokerError::Publish(e.to_string()))?;

        Ok(())
    }
}
