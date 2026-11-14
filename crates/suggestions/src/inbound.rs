//! The HTTP routes, the consumer that resolves suggestions from events, and
//! the one that moves background runs from their sessions' lifecycle events.

pub mod kafka_consumer;
pub mod router;
pub mod run_consumer;
