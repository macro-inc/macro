//! Inbound adapters: the SSE router and the public event log writer.

/// The `public-event-log` Kafka consumer.
#[cfg(feature = "consumer")]
pub mod log_writer;
/// The SSE and catalog routes.
#[cfg(feature = "inbound")]
pub mod stream_router;
