/// HTTP handlers, router, DTOs, and swagger definitions.
#[cfg(feature = "axum")]
pub mod http;
/// Kafka consumer fanning out `user.picture_changed` to contacts.
#[cfg(feature = "picture-fanout")]
pub mod user_picture_consumer;
/// SQS message parsing and worker.
#[cfg(feature = "inbound")]
pub mod worker;
