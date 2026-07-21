/// Kafka adapter implementing the [`EventPublisher`](crate::domain::ports::EventPublisher) port.
#[cfg(feature = "outbound")]
pub mod kafka_event_publisher;
/// AWS MSK IAM (SASL/OAUTHBEARER) auth support shared by producers and consumers.
pub use crate::kafka::msk_iam;
