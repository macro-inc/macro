//! Driven adapters: Postgres storage, the event broker, the person's open
//! sessions and the rollout.

pub mod gateway_updates;
pub mod kafka_events;
pub mod pg_time_repo;
pub mod rollout;
