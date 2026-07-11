/// Kafka adapter implementing the [`EventPublisher`](crate::domain::ports::EventPublisher) port.
pub mod kafka_event_publisher;
/// AWS MSK IAM (SASL/OAUTHBEARER) auth support shared by producers and consumers.
pub mod msk_iam;
