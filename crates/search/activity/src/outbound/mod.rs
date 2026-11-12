//! Outbound adapters.

#[cfg(all(feature = "consumer", feature = "realtime"))]
pub mod activity_topic_consumer;
#[cfg(feature = "consumer")]
pub mod kafka_activity_realtime;
#[cfg(feature = "outbound")]
pub mod pg_activity_repo;
