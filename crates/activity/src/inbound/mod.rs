//! Inbound adapters.

#[cfg(feature = "consumer")]
pub mod kafka_consumer;
#[cfg(feature = "ai_tools")]
pub mod toolset;
